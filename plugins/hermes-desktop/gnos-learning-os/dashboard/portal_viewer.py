"""Course portal viewer layer.

The Didaktos renderer emits one self-contained ``portal/index.html`` per course
and the Desktop reader transports that HTML into an iframe as a ``data:`` URL
(see ``PortalDialog`` in ``desktop/plugin.js``). Three things break or are
missing in that transport:

1. Lesson artifacts are referenced with filesystem-relative URLs
   (``../artifacts/diagrams/x.svg``). A ``data:`` document has no base
   directory, so diagrams render as a broken image icon or as an empty box.
   :func:`inline_artifacts` rewrites those references into data URIs (images)
   and ``srcdoc`` payloads (HTML diagrams) so the portal becomes genuinely
   self-contained.

2. The renderer already emits a numbered lesson sequence (``#lesson-list``
   with ``.num`` and ``.dot`` state classes) and a ``goLesson`` pager, but it
   hides the list with ``display:none``, marks every lesson but the first
   ``locked`` (the pager ignores locked buttons) and leaves all lesson
   sections stacked open — the reader cannot tell which lesson is first, which
   is second, or where they are.

3. A lesson has no "concluir" affordance and nothing records that it was
   consulted. :func:`inject_course_viewer` turns the stacked sections into a
   pager driven by the portal's own sequence, states the real position
   ("Aula 3 de 17") and posts ``gnos:lesson-progress`` to the Desktop host for
   every lesson that becomes current (``viewed``) or is explicitly completed
   (``completed``). The host persists it through
   ``POST /courses/{id}/lessons/{id}/progress``. Video sources are embedded
   instead of being left as bare links.

Both transforms are idempotent and leave a portal whose markup does not match
the expected contract untouched.
"""

from __future__ import annotations

import base64
import html as html_module
import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

__all__ = ["inline_artifacts", "inject_course_viewer", "portal_lesson_labels"]

# ---------------------------------------------------------------------------
# 1. Artifacts: relative references -> inline payloads
# ---------------------------------------------------------------------------

_ARTIFACT_SRC_RE = re.compile(r'(?P<prefix>\bsrc=")(?P<url>(?:\.{1,2}/)*artifacts/[^"]+)(?P<suffix>")')
_IFRAME_SRC_RE = re.compile(r'<iframe\b[^>]*\bsrc="(?P<url>[^"]+)"[^>]*>')
_IMG_TAG_RE = re.compile(r"<img\b[^>]*>")
_IMG_SRC_ATTR_RE = re.compile(r'(?P<prefix>\bsrc=")(?P<url>[^"]+)(?P<suffix>")')

_DATA_URI_MIME = {
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".avif": "image/avif",
}

_INLINE_HTML_SUFFIXES = (".html", ".htm")


_REMOTE_URL_RE = re.compile(r"^(?:[a-zA-Z][a-zA-Z0-9+.\-]*:|//|#)")


def _resolve_reference(portal_dir: Path, url: str) -> Optional[Path]:
    """Resolve a relative portal reference to a file inside the course directory.

    Renderers spell the same artifact two ways: ``../artifacts/x.svg`` (relative
    to ``portal/``) and ``artifacts/x.svg`` (relative to the course root). Both
    must land on the same file, and the result must stay inside the course
    directory so a portal can never read outside its own course. Absolute URLs
    (``data:``, ``http:``, ``//``, ``#``) are never local references.
    """
    if not url or _REMOTE_URL_RE.match(url):
        return None
    course_dir = portal_dir.parent
    for base in (portal_dir, course_dir):
        try:
            candidate = (base / url).resolve()
            if course_dir not in candidate.parents:
                continue
            if not candidate.is_file():
                continue
        except (OSError, RuntimeError, ValueError):  # unstatable path (too long, loops)
            continue
        return candidate
    return None


def _data_uri(path: Path, mime: str) -> str:
    payload = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{payload}"


def inline_artifacts(html: str, portal_dir: Path) -> str:
    """Inline every local artifact referenced by the portal HTML.

    Images become ``data:`` URIs; HTML diagrams become ``srcdoc`` documents
    (their own markup is escaped, so nested relative references cannot leak
    back onto the filesystem).
    """

    def inline_img(match: re.Match[str]) -> str:
        """Inline an <img> artifact and drop lazy-loading from it.

        A data URI costs no request, so deferring its decode only leaves the
        diagram blank until the reader scrolls onto it.
        """
        tag = match.group(0)
        src = _IMG_SRC_ATTR_RE.search(tag)
        if src is None or _REMOTE_URL_RE.match(src.group("url")):
            return tag
        path = _resolve_reference(portal_dir, src.group("url"))
        mime = _DATA_URI_MIME.get(path.suffix.lower()) if path is not None else None
        if path is None or not mime:
            return tag
        try:
            inlined = f"{src.group('prefix')}{_data_uri(path, mime)}{src.group('suffix')}"
        except OSError as error:
            logger.warning("portal artifact unreadable (%s): %s", src.group("url"), error)
            return tag
        tag = tag[: src.start()] + inlined + tag[src.end():]
        return re.sub(r'\s+loading="lazy"', "", tag)

    def replace_media(match: re.Match[str]) -> str:
        url = match.group("url")
        path = _resolve_reference(portal_dir, url)
        if path is None:
            return match.group(0)
        mime = _DATA_URI_MIME.get(path.suffix.lower())
        if not mime:
            return match.group(0)
        try:
            return f"{match.group('prefix')}{_data_uri(path, mime)}{match.group('suffix')}"
        except OSError as error:
            logger.warning("portal artifact unreadable (%s): %s", url, error)
            return match.group(0)

    def replace_iframe(match: re.Match[str]) -> str:
        url = match.group("url")
        if url.startswith("data:") or "://" in url:
            return match.group(0)
        path = _resolve_reference(portal_dir, url)
        if path is None or path.suffix.lower() not in _INLINE_HTML_SUFFIXES:
            return match.group(0)
        try:
            inner = path.read_text(encoding="utf-8")
        except OSError as error:
            logger.warning("portal diagram unreadable (%s): %s", url, error)
            return match.group(0)
        escaped = html_module.escape(inner, quote=True)
        return match.group(0).replace(f'src="{url}"', f'srcdoc="{escaped}"', 1)

    localized = _IMG_TAG_RE.sub(inline_img, html)
    localized = _ARTIFACT_SRC_RE.sub(replace_media, localized)
    return _IFRAME_SRC_RE.sub(replace_iframe, localized)


# ---------------------------------------------------------------------------
# 2. Lesson sequence: portal nav labels (used to bind sections to lessons)
# ---------------------------------------------------------------------------

_NAV_BUTTON_RE = re.compile(r'<button[^>]*data-lesson="(\d+)"[^>]*>(?P<body>.*?)</button>', re.S)
_TAG_RE = re.compile(r"<[^>]+>")
_MATH_RE = re.compile(r"\\\((.*?)\\\)")


def _normalize_label(value: str) -> str:
    text = _MATH_RE.sub(r"\1", value or "")
    text = _TAG_RE.sub(" ", text)
    text = html_module.unescape(text)
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    return re.sub(r"\s+", " ", text).strip().lower()


def portal_lesson_labels(html: str) -> List[str]:
    """Return the portal's lesson-sequence labels in the order the reader sees."""
    labels: List[str] = []
    for match in _NAV_BUTTON_RE.finditer(html):
        labels.append((match.group("body") or "").strip())
    return labels


def map_lessons_to_portal(portal_html: str, ordered_lessons: List[Dict[str, Any]]) -> List[Optional[str]]:
    """Bind each portal lesson position to a course lesson id.

    The portal sequence and the authored sequence normally agree, but the
    renderer wraps single letters in math spans (``\\(e\\)``) and drops lessons
    the course metadata does not list, so position alone is not authoritative.
    Labels are matched first and the authored position is the fallback.
    """
    by_label: Dict[str, str] = {}
    for lesson in ordered_lessons:
        by_label.setdefault(_normalize_label(lesson.get("title") or ""), lesson["id"])

    mapping: List[Optional[str]] = []
    for index, raw in enumerate(portal_lesson_labels(portal_html)):
        key = _normalize_label(raw)
        lesson_id = by_label.get(key)
        if lesson_id is None and index < len(ordered_lessons):
            lesson_id = ordered_lessons[index]["id"]
        mapping.append(lesson_id)
    for lesson in ordered_lessons[len(mapping):]:
        mapping.append(lesson["id"])
    return mapping


# ---------------------------------------------------------------------------
# 3. Viewer layer: sequence pager, "Concluir aula", video embeds
# ---------------------------------------------------------------------------

_VIEWER_MARKER = "data-gnos-course-viewer"

_VIEWER_CSS = """
#lesson-list{display:flex;flex-direction:column;}
.lesson-list button.locked{cursor:pointer;color:var(--ink-muted);}
.lesson-list button .gnos-seq-mark{margin-left:auto;font:600 10.5px/1 var(--body-font);letter-spacing:.04em;text-transform:uppercase;color:var(--ink-faint);}
.lesson-list button .gnos-seq-mark[data-state="completed"]{color:var(--done);}
.lesson-list button .gnos-seq-mark[data-state="viewed"]{color:var(--teal);}
.gnos-seq{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 16px;padding:9px 12px;border:1px solid var(--divider);border-radius:8px;background:var(--card);}
.gnos-seq-pos{font:700 12px/1 var(--mono-font);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-muted);}
.gnos-seq-state{font:600 11.5px/1 var(--body-font);letter-spacing:.04em;text-transform:uppercase;color:var(--ink-faint);}
.gnos-seq-state[data-state="completed"]{color:var(--done);}
.gnos-seq-state[data-state="viewed"]{color:var(--teal);}
.gnos-btn{font:600 12.5px/1 var(--body-font);padding:7px 11px;border-radius:7px;border:1px solid var(--divider-strong);background:var(--paper);color:var(--ink);cursor:pointer;}
.gnos-btn:hover{background:var(--row-selected);}
.gnos-btn[disabled]{opacity:.45;cursor:default;}
.gnos-ok{border-color:var(--teal);background:var(--teal);color:#FFF8EC;}
.gnos-ok.is-done{border-color:var(--done);background:var(--done);}
.gnos-seq-note{margin-left:auto;font:500 11.5px/1.4 var(--body-font);color:var(--warn);}
.gnos-video-embed{display:block;width:100%;max-width:760px;aspect-ratio:16/9;margin:14px auto 6px;border:1px solid var(--divider);border-radius:8px;background:#000;}
"""

_VIEWER_JS = """
(function () {
  var state = window.__GNOS_VIEWER__;
  if (!state) { return; }
  function onReady(fn) {
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', fn); }
    else { fn(); }
  }
  onReady(function () {
    embedVideos();

    var panels = Array.prototype.slice.call(document.querySelectorAll('#tab-lessons section.lesson'));
    if (panels.length < 1) { return; }
    var nav = document.getElementById('lesson-list');
    var buttons = nav ? Array.prototype.slice.call(nav.querySelectorAll('button[data-lesson]')) : [];
    var ids = state.lessonIds || [];
    var progress = Object.assign({}, state.progress || {});
    var hosts = Boolean(window.parent && window.parent !== window);
    var current = Math.min(Math.max(state.focusIndex || 0, 0), panels.length - 1);
    var reported = {};

    function lessonId(index) { return ids[index] || null; }
    function stateOf(index) {
      var value = progress[lessonId(index)];
      if (value === 'completed') { return 'completed'; }
      if (value === 'viewed') { return 'viewed'; }
      return 'pending';
    }
    function label(value) {
      if (value === 'completed') { return 'concluída'; }
      if (value === 'viewed') { return 'consultada'; }
      return 'pendente';
    }
    function post(message) {
      try { if (hosts) { window.parent.postMessage(message, '*'); } } catch (error) { /* host optional */ }
    }
    function report(index, next) {
      var id = lessonId(index);
      if (!id) { return; }
      if (stateOf(index) === 'completed' || stateOf(index) === next) { return; }
      progress[id] = next;
      post({
        type: 'gnos:lesson-progress',
        courseId: state.courseId || null,
        courseTitle: state.courseTitle || null,
        lessonId: id,
        lessonIndex: index,
        lessonTitle: (state.titles || [])[index] || null,
        state: next
      });
      paint();
    }

    var bars = panels.map(function (panel, index) {
      var bar = document.createElement('div');
      bar.className = 'gnos-seq';
      bar.setAttribute('data-gnos-bar', String(index));
      bar.innerHTML = '<span class="gnos-seq-pos"></span>'
        + '<button type="button" class="gnos-btn" data-gnos-role="prev">\\u2190 anterior</button>'
        + '<button type="button" class="gnos-btn gnos-ok" data-gnos-role="ok"></button>'
        + '<button type="button" class="gnos-btn" data-gnos-role="next">pr\\u00f3xima \\u2192</button>'
        + '<span class="gnos-seq-state"></span>';
      var ok = bar.querySelector('[data-gnos-role="ok"]');
      ok.addEventListener('click', function () { report(index, 'completed'); });
      bar.querySelector('[data-gnos-role="prev"]').addEventListener('click', function () { show(index - 1); });
      bar.querySelector('[data-gnos-role="next"]').addEventListener('click', function () { show(index + 1); });
      panel.insertBefore(bar, panel.firstChild);
      return bar;
    });

    if (!hosts) {
      bars.forEach(function (bar) {
        var note = document.createElement('span');
        note.className = 'gnos-seq-note';
        note.textContent = 'Aberto fora do leitor Hermes: o progresso não \\u00e9 registrado.';
        bar.appendChild(note);
      });
    }

    function paint() {
      panels.forEach(function (panel, index) {
        var value = stateOf(index);
        var bar = bars[index];
        var ok = bar.querySelector('[data-gnos-role="ok"]');
        var position = bar.querySelector('.gnos-seq-pos');
        var chip = bar.querySelector('.gnos-seq-state');
        var id = lessonId(index);
        position.textContent = 'Aula ' + (index + 1) + ' de ' + panels.length;
        chip.textContent = label(value);
        chip.setAttribute('data-state', value);
        ok.textContent = value === 'completed' ? '\\u2713 Aula conclu\\u00edda' : '\\u2713 Concluir esta aula';
        ok.classList.toggle('is-done', value === 'completed');
        ok.disabled = !id;
        ok.title = id ? 'Registra esta aula como conclu\\u00edda' : 'Aula sem registro no curso';
      });
      buttons.forEach(function (button) {
        var index = Number(button.getAttribute('data-lesson'));
        var value = stateOf(index);
        button.classList.toggle('current', index === current);
        button.classList.remove('locked');
        var dot = button.querySelector('.dot');
        if (dot) {
          dot.className = 'dot ' + (value === 'completed' ? 'done' : (index === current ? 'current' : ''));
        }
        var mark = button.querySelector('.gnos-seq-mark');
        if (!mark) {
          mark = document.createElement('span');
          mark.className = 'gnos-seq-mark';
          button.appendChild(mark);
        }
        mark.textContent = label(value);
        mark.setAttribute('data-state', value);
      });
    }

    function show(index) {
      current = Math.max(0, Math.min(panels.length - 1, Number(index) || 0));
      panels.forEach(function (panel, i) { panel.style.display = i === current ? '' : 'none'; });
      paint();
      report(current, 'viewed');
    }

    function currentFromPortal() {
      for (var i = 0; i < buttons.length; i += 1) {
        if (buttons[i].classList.contains('current')) { return Number(buttons[i].getAttribute('data-lesson')); }
      }
      return current;
    }

    if (nav) { nav.style.display = 'flex'; }
    buttons.forEach(function (button) {
      button.addEventListener('click', function () { window.setTimeout(function () { show(currentFromPortal()); }, 0); });
    });
    document.addEventListener('click', function (event) {
      var target = event.target;
      if (!target || !target.closest) { return; }
      if (target.closest('a.goto') || target.closest('#prev-link') || target.closest('#next-link')
          || target.closest('#lesson-list button') || target.closest('#tabs button')) {
        window.setTimeout(function () { show(currentFromPortal()); }, 0);
      }
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        window.setTimeout(function () { show(currentFromPortal()); }, 0);
      }
    });

    // The lesson route asked for one lesson, but the portal defaults to its
    // Overview tab: land on Lessons so the requested lesson (and its
    // sequence) is what the reader actually sees.
    var lessonsTab = document.querySelector('#tabs button[data-tab="lessons"]');
    if (lessonsTab && !lessonsTab.classList.contains('active')) { lessonsTab.click(); }
    show(current);
  });

  function embedVideos() {
    var pattern = /(?:youtube\\.com\\/(?:watch\\?v=|embed\\/|shorts\\/|live\\/)|youtu\\.be\\/)([A-Za-z0-9_-]{6,})/;
    var seen = {};
    var links = Array.prototype.slice.call(document.querySelectorAll('a[href]'));
    links.forEach(function (link) {
      var match = pattern.exec(link.getAttribute('href') || '');
      if (!match) { return; }
      // A portal rendered by the current generator already carries a player with
      // chapters for a cited video; only a bare citation link needs this fallback.
      if (link.closest('figure.video-embed')) { return; }
      var videoId = match[1];
      var card = link.closest('.source-card');
      var block = card || link.closest('dl') || link.closest('li') || link.closest('p') || link.parentNode;
      if (!block || seen[videoId] || block.querySelector('.gnos-video-embed')) { return; }
      seen[videoId] = 1;
      var frame = document.createElement('iframe');
      frame.className = 'gnos-video-embed';
      frame.setAttribute('src', 'https://www.youtube-nocookie.com/embed/' + videoId + '?rel=0');
      frame.setAttribute('title', 'V\\u00eddeo da aula: ' + (link.textContent || videoId).replace(/\\s+/g, ' ').trim());
      frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      frame.setAttribute('allow', 'encrypted-media; picture-in-picture; fullscreen');
      frame.setAttribute('allowfullscreen', '');
      frame.setAttribute('loading', 'lazy');
      if (card) { card.appendChild(frame); }
      else { block.parentNode.insertBefore(frame, block.nextSibling); }
    });
  }
})();
"""


def inject_course_viewer(html: str, viewer: Dict[str, Any]) -> str:
    """Inject the sequence/progress viewer layer into a served portal."""
    if _VIEWER_MARKER in html:
        return html
    payload = json.dumps(viewer, ensure_ascii=False).replace("</", "<\\/")
    block = (
        f'<style {_VIEWER_MARKER}="1">{_VIEWER_CSS}</style>\n'
        f'<script {_VIEWER_MARKER}="1">window.__GNOS_VIEWER__={payload};\n{_VIEWER_JS}</script>\n'
    )
    if "</body>" in html:
        return html.replace("</body>", block + "</body>", 1)
    return html + block
