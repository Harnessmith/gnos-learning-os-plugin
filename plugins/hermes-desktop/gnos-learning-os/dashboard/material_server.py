"""Serve course material from its own loopback origin.

Why a second origin instead of the dashboard routes:

* A lesson page framed by the desktop app would otherwise share the app's
  origin, so any script in a course document (generated HTML, simulation
  artifacts) could reach the app DOM. Course material is data, not app code.
* An embedded video needs a real origin: YouTube answers error 153 when the
  framing page is `data:`/`file:` (opaque origin) and never plays.
* Relative artifact paths (`../artifacts/...`) need a directory base. Serving
  the course root over HTTP lets the browser resolve them natively, which
  replaces inlining every artifact as a base64 `data:` URI.

The server binds `127.0.0.1` on an ephemeral port, serves only inside one
course root, and only for an opaque token minted per course with an expiry.
"""

from __future__ import annotations

import mimetypes
import secrets
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

TOKEN_TTL_SECONDS = 6 * 3600
_CONTENT_TYPES = {
    ".svg": "image/svg+xml",
    ".mjs": "text/javascript",
    ".js": "text/javascript",
    ".json": "application/json",
    ".wasm": "application/wasm",
    ".webmanifest": "application/manifest+json",
}

_lock = threading.Lock()
_tokens: dict[str, dict] = {}          # token -> {"root", "portal_rel", "expires"}
_resolver = None                       # course_id -> (root, portal_rel)
_entry_renderer = None                 # (course_id, lesson_id, html) -> html
_server: ThreadingHTTPServer | None = None


def set_resolver(resolver) -> None:
    """Register how a course id maps to its material root on disk."""
    global _resolver
    _resolver = resolver


def set_entry_renderer(renderer) -> None:
    """Register the transform applied to the portal document (viewer layer)."""
    global _entry_renderer
    _entry_renderer = renderer


def _ensure_running() -> str:
    """Start the loopback server once; return its origin."""
    global _server
    with _lock:
        if _server is None:
            _server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
            _server.daemon_threads = True
            threading.Thread(target=_server.serve_forever,
                             name="gnos-material", daemon=True).start()
        host, port = _server.server_address[:2]
    return f"http://{host}:{port}"


def course_origin(course_id: str) -> tuple[str, str, str]:
    """Mint (or reuse) the material origin of a course: (origin, token, portal_rel)."""
    if _resolver is None:
        raise RuntimeError("material server has no course resolver")
    root, portal_rel = _resolver(course_id)
    root = Path(root).resolve()
    now = time.time()
    with _lock:
        for token, entry in list(_tokens.items()):
            if entry["expires"] < now:
                _tokens.pop(token, None)
            elif entry["root"] == root:
                origin = _ensure_running()
                return origin, token, entry["portal_rel"]
        token = secrets.token_urlsafe(24)
        _tokens[token] = {"root": root, "portal_rel": portal_rel,
                          "course_id": course_id,
                          "expires": now + TOKEN_TTL_SECONDS}
    return _ensure_running(), token, portal_rel


def origin_and_base(course_id: str) -> tuple[str, str]:
    """(origin, asset base) where the base ends inside the portal directory."""
    origin, token, portal_rel = course_origin(course_id)
    portal_dir = str(Path(portal_rel).parent).strip(".") or ""
    base = f"{origin}/portal/{token}/"
    if portal_dir and portal_dir != ".":
        base += portal_dir.strip("/") + "/"
    return origin, base


def material_url(course_id: str, lesson_id: str = "") -> str:
    """Entry URL for the portal document of a course."""
    origin, token, portal_rel = course_origin(course_id)
    url = f"{origin}/portal/{token}/{portal_rel}"
    if lesson_id:
        url += f"?lesson={lesson_id}"
    return url


def resolve_request(token: str, rel_path: str):
    """(file, root, portal_rel, course) for a request, or None when not servable."""
    with _lock:
        entry = _tokens.get(token)
        current = None
        if entry is not None and entry["expires"] >= time.time():
            current = dict(entry)
    if current is None:
        return None
    root = current["root"]
    target = (root / rel_path.lstrip("/")).resolve()
    if target != root and root not in target.parents:
        return None
    if not target.is_file():
        return None
    return target, root, current["portal_rel"], current.get("course_id", "")


def content_type(path: Path) -> str:
    suffix = path.suffix.lower()
    base = _CONTENT_TYPES.get(suffix) or mimetypes.guess_type(str(path))[0] or "application/octet-stream"
    if (base.startswith("text/") or base in ("application/json", "image/svg+xml",
                                             "application/javascript")):
        return f"{base}; charset=utf-8"
    return base


class _Handler(BaseHTTPRequestHandler):
    server_version = "GnosMaterial/1.0"
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt, *args):    # keep the app log clean
        return

    def _send(self, status: int, body: bytes = b"",
              ctype: str = "text/plain; charset=utf-8", head_only: bool = False) -> None:
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if not head_only and body:
            self.wfile.write(body)

    def do_HEAD(self):
        self.do_GET(head_only=True)

    def do_GET(self, head_only: bool = False):
        parts = urlsplit(self.path)
        segments = unquote(parts.path).split("/")
        if len(segments) < 4 or segments[1] != "portal":      # /portal/<token>/<relpath>
            self._send(404, b"not found", head_only=head_only)
            return
        token = segments[2]
        rel_path = "/".join(segments[3:])
        resolved = resolve_request(token, rel_path)
        if resolved is None:
            self._send(403, b"forbidden", head_only=head_only)
            return
        target, root, portal_rel, course_id = resolved
        lesson_id = ""
        for chunk in (parts.query or "").split("&"):
            if chunk.startswith("lesson="):
                lesson_id = unquote(chunk.split("=", 1)[1])
        if _entry_renderer and str(target.relative_to(root)) == portal_rel:
            html = target.read_text(encoding="utf-8", errors="replace")
            try:
                html = _entry_renderer(course_id, lesson_id, html)
            except Exception as exc:            # never serve a silent blank page
                html += f"\n<!-- viewer layer failed: {type(exc).__name__}: {exc} -->"
            self._send(200, html.encode("utf-8"), "text/html; charset=utf-8",
                       head_only=head_only)
            return
        self._send(200, target.read_bytes(), content_type(target), head_only=head_only)
