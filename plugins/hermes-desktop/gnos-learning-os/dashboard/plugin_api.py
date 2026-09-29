"""Didaktos Learning OS - plugin backend.

Mounted at ``/api/plugins/gnos-learning-os/`` inside the Hermes gateway
process (see ``dashboard/manifest.json``). This is the ONLY door the desktop
plugin UI is allowed to use for pedagogical data - the renderer never reads
Didaktos course files, learner state, or executes anything directly (see
``../contracts.md``).

Storage: PostgreSQL, schema ``gnos_learning_os`` inside the local ``memory``
database already running on this host (see ``_connect()``). This is a local,
plugin-owned persistence layer - NOT the Didaktos profile's own learner state
(``skills/learner-tracking/scripts/learner_state.py`` for lesson history, or
``skills/review-engine/scripts/write_evidence.py`` for per-competency
evidence). Phase 4 (see ``sync_evidence.py`` beside this file) bridges the
profile's evidence files into this schema's ``evidence`` table one domain at
a time, run explicitly after a teaching session - it is NOT a live
subscription. Tracks/sessions/timeline/labs/resources/projects remain
fixture-seeded until a later phase extends the bridge to them.

Design invariants (see docs/gnos-learning-os/02_PLUGIN_BACKEND_AND_CONTRACTS.md):
  - planned vs actual timelines are DISTINCT and APPEND-ONLY: a reschedule or
    repair session never rewrites a `planned` row; it only ever adds new
    `actual` rows. History is never destroyed.
  - Evidence status transitions are one-directional in strength
    (unknown -> exposed -> practicing -> demonstrated -> retained), with
    `repair-needed` reachable from any state on a failed check; hints/worked
    examples never themselves imply `demonstrated`.
  - Assessment/lab submissions are idempotent by `attempt_id` - replaying the
    same attempt_id must not create a duplicate attempt or evidence bump.
  - The lab runner in this phase is a restricted MOCK runner: it never
    executes arbitrary shell commands. It records deterministic, canned
    check results per lab so the desktop UI can exercise the full
    start -> check -> reset lifecycle before a real isolated runner exists.
"""

from __future__ import annotations

import json
import logging
import os
import re
import sys
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator, Optional

import psycopg
from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

# The gateway loads plugin_api.py as a standalone module; make the sibling
# dashboard/services package importable in that loader mode.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from services.recommendations import choose_next
import portal_viewer  # noqa: E402 - sibling module: portal artifacts + viewer layer
import material_server  # noqa: E402 - sibling module: loopback origin for course material

log = logging.getLogger("gnos_learning_os")

router = APIRouter()

VALID_COMPETENCY_STATES = (
    "unknown",
    "exposed",
    "practicing",
    "demonstrated",
    "retained",
    "repair-needed",
)

SCHEMA = "gnos_learning_os"

# Root of the Didaktos profile workspace where portals are rendered
# (learners/<learner>/courses/<course-id>/portal/index.html). The desktop
# renderer never gets a filesystem path: it always fetches portal HTML
# through the routes below, which read the file on THIS host (the gateway
# process) and hand back the markup over the same connection (local or
# remote/SSH) the rest of the plugin API already uses. `file://<server-path>`
# only ever resolves on the machine that has that path, which is this
# server, never the user's local Electron process — that mismatch is why the
# previous "open in OS browser" approach was silently broken for any
# non-local gateway connection.
WORKSPACE_ROOT = Path(
    os.environ.get(
        "DIDAKTOS_WORKSPACE_ROOT",
        os.path.expanduser("~/.hermes/profiles/didaktos/workspace"),
    )
).resolve()


def _inline_portal_assets(html: str, portal_dir: Path) -> str:
    """Inline local CSS/JS so the HTML remains self-contained in a data: iframe.

    The Desktop reader intentionally transports portal HTML as a data URL. A
    relative ``assets/...`` URL has no base directory in that context, so
    KaTeX/highlight silently fail to load. Only known, renderer-owned assets
    are inlined; external URLs and unknown paths remain untouched.
    """
    replacements = {
        'assets/katex/katex.min.css': ("style", "katex/katex.min.css"),
        'assets/highlight/github-dark.min.css': ("style", "highlight/github-dark.min.css"),
        'assets/katex/katex.min.js': ("script", "katex/katex.min.js"),
        'assets/katex/auto-render.min.js': ("script", "katex/auto-render.min.js"),
        'assets/highlight/highlight.min.js': ("script", "highlight/highlight.min.js"),
    }
    for asset_url, (kind, relative_path) in replacements.items():
        asset_path = (portal_dir / "assets" / relative_path).resolve()
        if not asset_path.is_file():
            log.warning("portal asset missing: %s", asset_path)
            continue
        try:
            asset = asset_path.read_text(encoding="utf-8")
        except OSError:
            continue
        if kind == "style":
            html = html.replace(
                f'<link rel="stylesheet" href="{asset_url}">',
                f'<style data-inlined-asset="{asset_url}">{asset}</style>',
            )
        else:
            html = html.replace(
                f'<script defer src="{asset_url}"></script>',
                f'<script data-inlined-asset="{asset_url}">{asset}</script>',
            )
    return html


def _read_portal_html(portal_path: Optional[str]) -> str:
    """Read a rendered portal while retaining the workspace boundary.

    Older syncs recorded ``~/learners/...`` while course rendering already
    lived under ``DIDAKTOS_WORKSPACE_ROOT/learners/...``. Translate only that
    exact legacy layout; arbitrary stored paths remain rejected.
    """
    if not portal_path:
        raise HTTPException(status_code=404, detail="no portal rendered for this lesson yet")
    try:
        resolved = Path(portal_path).resolve()
    except (OSError, RuntimeError) as exc:
        raise HTTPException(status_code=404, detail="invalid portal path") from exc

    allowed_root = (WORKSPACE_ROOT / "learners").resolve()
    if allowed_root not in resolved.parents and resolved != allowed_root:
        legacy_root = (Path.home() / "learners").resolve()
        try:
            legacy_relative = resolved.relative_to(legacy_root)
        except ValueError:
            legacy_relative = None
        if legacy_relative is not None:
            translated = (allowed_root / legacy_relative).resolve()
            if translated.is_file():
                log.info("translated legacy portal path %s -> %s", resolved, translated)
                resolved = translated

    if allowed_root not in resolved.parents and resolved != allowed_root:
        log.warning("refusing portal path outside workspace: %s", resolved)
        raise HTTPException(status_code=404, detail="portal not found")
    if resolved.name != "index.html" or not resolved.is_file():
        raise HTTPException(status_code=404, detail="portal not found")
    try:
        html = resolved.read_text(encoding="utf-8")
    except OSError as exc:
        raise HTTPException(status_code=404, detail="portal not found") from exc
    html = _inline_portal_assets(html, resolved.parent)
    # A data:-transported portal has no base directory, so lesson artifacts
    # (../artifacts/...) must be inlined as well, not only renderer CSS/JS.
    return portal_viewer.inline_artifacts(html, resolved.parent)


def _conninfo() -> str:
    """Local PostgreSQL, `memory` database, dedicated schema.

    Credentials come exclusively from ``~/.pgpass`` (never hardcoded here or
    logged) via the standard libpq `passfile` mechanism. Host/user/db/schema
    are overridable via env vars for a future non-dev deployment.
    """
    host = os.environ.get("DIDAKTOS_PG_HOST", "localhost")
    port = os.environ.get("DIDAKTOS_PG_PORT", "5432")
    user = os.environ.get("DIDAKTOS_PG_USER", "memory")
    dbname = os.environ.get("DIDAKTOS_PG_DATABASE", "memory")
    passfile = os.environ.get("PGPASSFILE", os.path.expanduser("~/.pgpass"))
    schema = os.environ.get("DIDAKTOS_PG_SCHEMA", SCHEMA)
    return (
        f"postgresql://{user}@{host}:{port}/{dbname}"
        f"?options=-c%20search_path%3D{schema}&passfile={passfile}"
    )


@contextmanager
def _connect() -> Iterator[psycopg.Connection]:
    conn = psycopg.connect(_conninfo(), row_factory=dict_row, autocommit=False)
    try:
        yield conn
    finally:
        conn.close()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


_SCHEMA_DDL = f"""
CREATE SCHEMA IF NOT EXISTS {SCHEMA};

CREATE TABLE IF NOT EXISTS {SCHEMA}.tracks (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    stage TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unknown',
    source_type TEXT NOT NULL DEFAULT 'user',
    source_id TEXT,
    detail TEXT,
    competencies_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.sessions (
    id TEXT PRIMARY KEY,
    track_id TEXT REFERENCES {SCHEMA}.tracks(id) ON DELETE SET NULL,
    kind TEXT NOT NULL,
    planned_topic TEXT,
    actual_topic TEXT,
    planned_date TEXT,
    actual_date TEXT,
    planned_duration INTEGER,
    actual_duration INTEGER,
    objectives_json TEXT NOT NULL DEFAULT '[]',
    activities_json TEXT NOT NULL DEFAULT '[]',
    objective TEXT,
    teacher TEXT,
    blocks_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'planned',
    started_at TEXT,
    completed_at TEXT,
    next_step TEXT,
    portal_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
ALTER TABLE {SCHEMA}.tracks ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'user';
ALTER TABLE {SCHEMA}.tracks ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE {SCHEMA}.sessions ADD COLUMN IF NOT EXISTS portal_path TEXT;

-- Append-only. A reschedule/repair NEVER updates an existing row; it only
-- inserts a new one. `source` distinguishes the two chronologies.
CREATE TABLE IF NOT EXISTS {SCHEMA}.session_notes (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES {SCHEMA}.sessions(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.timeline_entries (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES {SCHEMA}.sessions(id) ON DELETE SET NULL,
    track_id TEXT REFERENCES {SCHEMA}.tracks(id) ON DELETE SET NULL,
    source TEXT NOT NULL,
    entry_date TEXT NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    adaptive_reason TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.assessments (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES {SCHEMA}.sessions(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    result TEXT,
    help_used TEXT DEFAULT '-',
    evidence_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Idempotency key: replaying the same attempt_id must be a no-op on the
-- second call (submit handler checks this table first).
CREATE TABLE IF NOT EXISTS {SCHEMA}.attempts (
    id TEXT PRIMARY KEY,
    assessment_id TEXT NOT NULL REFERENCES {SCHEMA}.assessments(id) ON DELETE CASCADE,
    attempt_id TEXT NOT NULL,
    outcome TEXT NOT NULL,
    help_used TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(assessment_id, attempt_id)
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.evidence (
    id TEXT PRIMARY KEY,
    competency_id TEXT NOT NULL UNIQUE,
    label TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'unknown',
    attempts INTEGER NOT NULL DEFAULT 0,
    detail TEXT,
    misconceptions_json TEXT NOT NULL DEFAULT '[]',
    next_intervention TEXT,
    depth INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.evidence_history (
    id TEXT PRIMARY KEY,
    competency_id TEXT NOT NULL,
    label TEXT NOT NULL,
    status TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    detail TEXT,
    recorded_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.resources (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT,
    url TEXT,
    provenance TEXT DEFAULT 'course-authored',
    folder_id TEXT,
    lesson_id TEXT,
    competency_id TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.library_favorites (
    item_id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.session_resources (
    session_id TEXT NOT NULL REFERENCES {SCHEMA}.sessions(id) ON DELETE CASCADE,
    resource_id TEXT NOT NULL REFERENCES {SCHEMA}.resources(id) ON DELETE CASCADE,
    used_at TEXT NOT NULL,
    PRIMARY KEY (session_id, resource_id)
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    competencies TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
ALTER TABLE {SCHEMA}.projects ADD COLUMN IF NOT EXISTS objective TEXT;
ALTER TABLE {SCHEMA}.projects ADD COLUMN IF NOT EXISTS next_step TEXT;
ALTER TABLE {SCHEMA}.projects ADD COLUMN IF NOT EXISTS completed_at TEXT;

-- Project scope/status may be edited, but the learner's work record remains
-- append-only so the detail view can never rewrite or hide prior evidence.
CREATE TABLE IF NOT EXISTS {SCHEMA}.project_milestones (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES {SCHEMA}.projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'planned',
    due_date TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.project_activities (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES {SCHEMA}.projects(id) ON DELETE CASCADE,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.project_evidence (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES {SCHEMA}.projects(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    url TEXT,
    detail TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.labs (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES {SCHEMA}.sessions(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    objective TEXT,
    environment_json TEXT NOT NULL DEFAULT '{{}}',
    initial_state TEXT,
    allowed_tools_json TEXT NOT NULL DEFAULT '[]',
    task TEXT,
    expected_behavior TEXT,
    deterministic_checks_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'not_started',
    terminal_output TEXT DEFAULT '',
    evidence_note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.lab_checks (
    id TEXT PRIMARY KEY,
    lab_id TEXT NOT NULL REFERENCES {SCHEMA}.labs(id) ON DELETE CASCADE,
    check_name TEXT NOT NULL,
    passed INTEGER NOT NULL,
    output TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.courses (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    goal TEXT,
    vision TEXT,
    depth TEXT,
    length TEXT,
    chapters_json TEXT NOT NULL DEFAULT '[]',
    sources_json TEXT NOT NULL DEFAULT '{{}}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.course_lessons (
    id TEXT NOT NULL,
    course_id TEXT NOT NULL REFERENCES {SCHEMA}.courses(id) ON DELETE CASCADE,
    chapter_id TEXT,
    topic_id TEXT,
    title TEXT NOT NULL,
    purpose TEXT,
    teacher TEXT,
    concepts_json TEXT NOT NULL DEFAULT '[]',
    blocks_json TEXT NOT NULL DEFAULT '[]',
    exercises_json TEXT NOT NULL DEFAULT '[]',
    publication TEXT NOT NULL DEFAULT 'draft',
    portal_path TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (course_id, id)
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.course_artifacts (
    id TEXT NOT NULL,
    course_id TEXT NOT NULL REFERENCES {SCHEMA}.courses(id) ON DELETE CASCADE,
    chapter_id TEXT,
    topic_id TEXT,
    lesson_id TEXT,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    purpose TEXT,
    location_json TEXT NOT NULL DEFAULT '{{}}',
    mime_type TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (course_id, id)
);

CREATE INDEX IF NOT EXISTS idx_course_lessons_course ON {SCHEMA}.course_lessons(course_id);
CREATE INDEX IF NOT EXISTS idx_course_artifacts_course ON {SCHEMA}.course_artifacts(course_id);
CREATE INDEX IF NOT EXISTS idx_course_artifacts_lesson ON {SCHEMA}.course_artifacts(lesson_id);
CREATE INDEX IF NOT EXISTS idx_timeline_session ON {SCHEMA}.timeline_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_timeline_source ON {SCHEMA}.timeline_entries(source);
CREATE INDEX IF NOT EXISTS idx_attempts_assessment ON {SCHEMA}.attempts(assessment_id);
CREATE INDEX IF NOT EXISTS idx_lab_checks_lab ON {SCHEMA}.lab_checks(lab_id);
CREATE INDEX IF NOT EXISTS idx_project_milestones_project ON {SCHEMA}.project_milestones(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_project_activities_project ON {SCHEMA}.project_activities(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_project_evidence_project ON {SCHEMA}.project_evidence(project_id, created_at);

CREATE TABLE IF NOT EXISTS {SCHEMA}.lesson_progress (
    course_id TEXT NOT NULL REFERENCES {SCHEMA}.courses(id) ON DELETE CASCADE,
    lesson_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'viewed',
    viewed_at TEXT,
    completed_at TEXT,
    source TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (course_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_progress_course ON {SCHEMA}.lesson_progress(course_id, state);
"""


def _ensure_schema() -> None:
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(_SCHEMA_DDL)
        conn.commit()


# --------------------------------------------------------------------------
# Legacy demo fixture
#
# This function is intentionally retained only as a development helper for
# backwards-compatible local experiments. Production routes MUST NOT call it:
# the learner dashboard is populated exclusively by Didaktos sync events.
# --------------------------------------------------------------------------

def _seed_demo_fixture_for_local_development(conn: psycopg.Connection) -> None:
    with conn.cursor() as cur:
        cur.execute(f"SELECT COUNT(*) AS n FROM {SCHEMA}.tracks")
        existing = cur.fetchone()["n"]
        if existing:
            return

        now = _now()

        tracks = [
            ("track-devops", "DevOps", "Junior -> Pleno", "practicing", "Docker Networking em pratica", []),
            ("track-aws", "AWS", "Fundamentos", "exposed", "IAM e regioes", []),
            ("track-ingles", "Ingles", "Tecnico", "retained", "Leitura de documentacao", []),
            ("track-direito", "Direito", "Fundamentos", "unknown", "Sem plano ativo", []),
        ]
        for tid, title, stage, status, detail, comps in tracks:
            cur.execute(
                f"INSERT INTO {SCHEMA}.tracks (id, title, stage, status, detail, competencies_json, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s, %s)",
                (tid, title, stage, status, detail, json.dumps(comps), now, now),
            )

        session_id = "session-docker-networking"
        cur.execute(
            f"INSERT INTO {SCHEMA}.sessions (id, track_id, kind, planned_topic, actual_topic, planned_date, actual_date, "
            "planned_duration, actual_duration, objectives_json, activities_json, objective, teacher, blocks_json, "
            "status, started_at, next_step, created_at, updated_at) VALUES "
            "(%s, %s, 'lesson', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'in_progress', %s, %s, %s, %s)",
            (
                session_id,
                "track-devops",
                "Docker Networking: nomes, DNS e isolamento",
                "Docker Networking: nomes, DNS e isolamento",
                "2026-09-23",
                "2026-09-25",
                90,
                None,
                json.dumps(["Diagnosticar por que um container nao encontra outro pelo nome do servico."]),
                json.dumps(["leitura", "diagrama", "codigo", "exercicio"]),
                "Diagnosticar por que um container nao encontra outro pelo nome do servico.",
                "Professor Didaktos - contexto da sessao preservado",
                json.dumps(
                    [
                        ["Texto", "Containers compartilham o host, mas nao compartilham automaticamente a mesma rede de aplicacao."],
                        ["Diagrama", "web -- bridge app-net -- api\n                 |-- db"],
                        ["Codigo", "docker network create app-net\ndocker run --network app-net --name api api:latest\ndocker exec web getent hosts api"],
                        ["Exercicio", "Por que `localhost:8080` dentro de `web` nao chega ao container `api`?"],
                    ]
                ),
                now,
                "Checkpoint: redes bridge e portas publicadas",
                now,
                now,
            ),
        )

        planned = [
            ("23 Set", "lesson", "Docker: redes bridge"),
            ("25 Set", "lab", "DNS entre containers"),
            ("28 Set", "checkpoint", "Rede, portas e isolamento"),
        ]
        actual = [
            ("23 Set", "lesson", "Docker: redes bridge", None),
            ("25 Set", "repair", "Reparo inserido: DNS e localhost", "Erro de localhost/DNS detectado no lab; sessao de reparo inserida antes de prosseguir."),
            ("25 Set", "lab", "DNS entre containers - em andamento", None),
            ("28 Set", "checkpoint", "Rede, portas e isolamento", None),
        ]
        for date, kind, text in planned:
            cur.execute(
                f"INSERT INTO {SCHEMA}.timeline_entries (id, session_id, source, entry_date, kind, text, adaptive_reason, created_at) "
                "VALUES (%s, %s, 'planned', %s, %s, %s, NULL, %s)",
                (str(uuid.uuid4()), session_id, date, kind, text, now),
            )
        for date, kind, text, reason in actual:
            cur.execute(
                f"INSERT INTO {SCHEMA}.timeline_entries (id, session_id, source, entry_date, kind, text, adaptive_reason, created_at) "
                "VALUES (%s, %s, 'actual', %s, %s, %s, %s, %s)",
                (str(uuid.uuid4()), session_id, date, kind, text, reason, now),
            )

        lab_id = "lab-dns-entre-containers"
        cur.execute(
            f"INSERT INTO {SCHEMA}.labs (id, session_id, title, objective, environment_json, initial_state, allowed_tools_json, "
            "task, expected_behavior, deterministic_checks_json, status, terminal_output, evidence_note, created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'ready_to_check', %s, %s, %s, %s)",
            (
                lab_id,
                session_id,
                "Falha de DNS entre containers",
                "Corrija a conexao de web para api sem publicar portas desnecessarias.",
                json.dumps({"kind": "mock-sandbox", "containers": ["web", "api", "db"], "network": "app-net"}),
                "web e api existem mas nao compartilham rede; web tenta localhost:8080.",
                json.dumps(["curl", "docker network", "getent hosts"]),
                "Fazer `web` resolver `api` pelo nome do servico e obter resposta 200 de /health.",
                "curl http://api:8080/health deve retornar 200 a partir do container web.",
                json.dumps(
                    [
                        {"name": "web_resolves_api_dns", "expect": "getent hosts api resolves"},
                        {"name": "web_reaches_api_health", "expect": "curl http://api:8080/health == 200"},
                    ]
                ),
                "$ curl http://api:8080/health\ncurl: (6) Could not resolve host: api",
                "Pista utilizada uma vez - tentativa atual ainda nao e evidencia demonstrada.",
                now,
                now,
            ),
        )

        assessment_id = "assessment-checkpoint-redes-docker"
        cur.execute(
            f"INSERT INTO {SCHEMA}.assessments (id, session_id, title, type, status, result, help_used, evidence_count, created_at, updated_at) "
            "VALUES (%s, %s, 'Checkpoint de redes Docker', 'checkpoint', 'corrected', "
            "'Partial - distinguiu porta publicada de porta interna; DNS requer reforco.', '1 pista', 2, %s, %s)",
            (assessment_id, session_id, now, now),
        )
        cur.execute(
            f"INSERT INTO {SCHEMA}.assessments (id, session_id, title, type, status, result, help_used, evidence_count, created_at, updated_at) "
            "VALUES (%s, NULL, 'Projeto integrador: stack observavel', 'project', 'planned', "
            "'Exercita redes, logs e health checks.', '-', 0, %s, %s)",
            (str(uuid.uuid4()), now, now),
        )

        evidence_rows = [
            ("evidence-devops", "devops", "DevOps", "practicing", 2, "2 evidencias", 0),
            ("evidence-containers", "containers", "Containers", "practicing", 1, "1 tentativa independente", 1),
            ("evidence-docker", "docker", "Docker", "practicing", 1, "DNS entre servicos", 2),
            ("evidence-networking", "networking", "Networking", "repair-needed", 1, "Proxima intervencao: lab guiado", 3),
        ]
        for eid, cid, label, status, attempts, detail, depth in evidence_rows:
            cur.execute(
                f"INSERT INTO {SCHEMA}.evidence (id, competency_id, label, status, attempts, detail, misconceptions_json, "
                "next_intervention, depth, updated_at) VALUES (%s, %s, %s, %s, %s, %s, '[]', %s, %s, %s)",
                (
                    eid,
                    cid,
                    label,
                    status,
                    attempts,
                    detail,
                    "Proxima intervencao: lab guiado" if status == "repair-needed" else None,
                    depth,
                    now,
                ),
            )

        resources = [
            ("Documentacao oficial", "Docker - Networking overview", "Leitura de apoio", "https://docs.docker.com/network/", "official-docs"),
            ("Lab", "DNS entre containers", "Sessao atual", None, "course-authored"),
            ("Video", "Como redes bridge resolvem servicos", "Trecho recomendado: 08:20-13:40", None, "course-authored"),
        ]
        for rtype, title, detail, url, provenance in resources:
            cur.execute(
                f"INSERT INTO {SCHEMA}.resources (id, type, title, detail, url, provenance, created_at) VALUES (%s, %s, %s, %s, %s, %s, %s)",
                (str(uuid.uuid4()), rtype, title, detail, url, provenance, now),
            )

        cur.execute(
            f"INSERT INTO {SCHEMA}.projects (id, title, competencies, status, created_at, updated_at) "
            "VALUES (%s, 'Stack observavel em Docker Compose', 'Docker Networking - Logs - Health checks', 'planned', %s, %s)",
            (str(uuid.uuid4()), now, now),
        )

    conn.commit()


def _ensure_seeded() -> None:
    """Ensure durable storage exists without inventing learner data.

    The historical name is kept because every route uses this guard. It no
    longer seeds the DevOps demo; visible rows must originate in a Didaktos
    publication/synchronization event.
    """
    _ensure_schema()


# --------------------------------------------------------------------------
# Row -> dict helpers
# --------------------------------------------------------------------------

def _track_dict(row: dict) -> dict:
    d = dict(row)
    d["competencies"] = json.loads(d.pop("competencies_json") or "[]")
    return d


def _session_dict(row: dict) -> dict:
    d = dict(row)
    d["objectives"] = json.loads(d.pop("objectives_json") or "[]")
    d["activities"] = json.loads(d.pop("activities_json") or "[]")
    d["blocks"] = json.loads(d.pop("blocks_json") or "[]")
    return d


_YOUTUBE_EMBED_RE = re.compile(
    r'<iframe[^>]+src=["\']https?://(?:www\.)?youtube(?:-nocookie)?\.com/embed/'
    r'([A-Za-z0-9_-]{6,})[^"\']*["\'][^>]*title=["\']([^"\']+)',
    re.IGNORECASE,
)


def _lesson_video_sources(portal_html: str, position: int | None = None) -> list[dict]:
    """Expose the selected lesson's video as structured plugin-page data.

    YouTube rejects an iframe nested in an Electron plugin document without a
    normal browser HTTP referrer (error 153). The plugin therefore renders the
    video card itself and opens the official watch page for playback.
    """
    sections = re.split(r'<section\s+class=["\']lesson["\'][^>]*>', portal_html, flags=re.IGNORECASE)
    lesson_html = sections[position] if position and position < len(sections) else portal_html
    seen: set[str] = set()
    videos = []
    for video_id, title in _YOUTUBE_EMBED_RE.findall(lesson_html):
        if video_id in seen:
            continue
        seen.add(video_id)
        videos.append({
            "id": video_id,
            "title": title.replace("&amp;", "&").strip() or "Vídeo da aula",
            "url": f"https://www.youtube.com/watch?v={video_id}",
            "thumbnail_url": f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg",
        })
    return videos


def _assessment_dict(row: dict) -> dict:
    return dict(row)


def _evidence_dict(row: dict) -> dict:
    d = dict(row)
    d["misconceptions"] = json.loads(d.pop("misconceptions_json") or "[]")
    return d


def _lab_dict(row: dict) -> dict:
    d = dict(row)
    d["environment"] = json.loads(d.pop("environment_json") or "{}")
    d["allowed_tools"] = json.loads(d.pop("allowed_tools_json") or "[]")
    d["deterministic_checks"] = json.loads(d.pop("deterministic_checks_json") or "[]")
    return d


def _project_dict(row: dict, milestones: list[dict] | None = None) -> dict:
    """Expose legacy project rows and the new operational fields uniformly."""
    d = dict(row)
    raw_competencies = d.get("competencies") or "[]"
    try:
        d["competencies"] = json.loads(raw_competencies)
    except (TypeError, json.JSONDecodeError):
        d["competencies"] = [item.strip() for item in str(raw_competencies).split("-") if item.strip()]
    milestone_rows = milestones or []
    completed = sum(1 for milestone in milestone_rows if milestone["status"] == "completed")
    d["milestones_total"] = len(milestone_rows)
    d["milestones_completed"] = completed
    d["progress_percent"] = round(completed * 100 / len(milestone_rows)) if milestone_rows else 0
    return d


# --------------------------------------------------------------------------
# GET routes
# --------------------------------------------------------------------------

@router.get("/health")
async def health():
    _ensure_seeded()
    return {"ok": True}


@router.get("/study/next")
async def get_next_study():
    """Return the highest-priority next action for the personal learner."""
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT * FROM {SCHEMA}.sessions "
            "WHERE status = 'in_progress' ORDER BY updated_at DESC LIMIT 1"
        )
        active = cur.fetchone()
        cur.execute(
            f"SELECT * FROM {SCHEMA}.evidence "
            "WHERE status = 'repair-needed' ORDER BY updated_at ASC LIMIT 1"
        )
        repair = cur.fetchone()
        cur.execute(
            f"SELECT * FROM {SCHEMA}.sessions "
            "WHERE status = 'planned' ORDER BY planned_date ASC, updated_at ASC LIMIT 1"
        )
        planned = cur.fetchone()
    active_data = _session_dict(active) if active else None
    repair_data = _evidence_dict(repair) if repair else None
    planned_data = _session_dict(planned) if planned else None
    kind, reason, payload = choose_next(active_data, repair_data, planned_data)
    if kind == "session":
        return {"kind": kind, "reason": reason, "session": payload}
    if kind == "repair":
        return {"kind": kind, "reason": reason, "competency": payload}
    if kind == "lesson":
        return {"kind": kind, "reason": reason, "session": payload}
    return {"kind": kind, "reason": reason}


@router.get("/review/queue")
async def get_review_queue(limit: int = 20):
    """Return a small review queue ordered by pedagogical urgency."""
    _ensure_seeded()
    limit = max(1, min(int(limit), 100))
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT * FROM {SCHEMA}.evidence "
            "WHERE status IN ('repair-needed', 'practicing', 'exposed') "
            "ORDER BY CASE status WHEN 'repair-needed' THEN 0 WHEN 'practicing' THEN 1 ELSE 2 END, updated_at ASC "
            "LIMIT %s",
            (limit,),
        )
        items = [_evidence_dict(row) for row in cur.fetchall()]
    return {"items": items, "total": len(items), "limit": limit}


@router.get("/today")
async def get_today():
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT * FROM {SCHEMA}.sessions WHERE track_id LIKE 'track-course-%' "
            "AND status = 'in_progress' ORDER BY updated_at DESC LIMIT 1"
        )
        session = cur.fetchone()
        if session is None:
            cur.execute(
                f"SELECT * FROM {SCHEMA}.sessions WHERE track_id LIKE 'track-course-%' "
                "ORDER BY planned_date DESC LIMIT 1"
            )
            session = cur.fetchone()
        track = None
        if session and session["track_id"]:
            cur.execute(f"SELECT * FROM {SCHEMA}.tracks WHERE id = %s", (session["track_id"],))
            track = cur.fetchone()
    if session is None:
        return {"session": None}
    s = _session_dict(session)
    return {
        "date": s.get("actual_date") or s.get("planned_date"),
        "track": f"{track['title']} - {track['stage']}" if track else None,
        "session_id": s["id"],
        "session": s.get("actual_topic") or s.get("planned_topic"),
        "objective": s.get("objective"),
        "duration": s.get("planned_duration"),
        "actual_duration": s.get("actual_duration"),
        "started_at": s.get("started_at"),
        "next": s.get("next_step"),
        "status": s.get("status"),
    }


@router.get("/tracks")
async def list_tracks():
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT * FROM {SCHEMA}.tracks "
            "WHERE id LIKE 'track-course-%' OR id LIKE 'track-domain-%' OR id LIKE 'track-user-%' ORDER BY created_at ASC"
        )
        rows = cur.fetchall()
    return {"tracks": [_track_dict(r) for r in rows]}


@router.get("/tracks/{track_id}")
async def get_track(track_id: str):
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.tracks WHERE id = %s", (track_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="track not found")
        cur.execute(
            f"SELECT * FROM {SCHEMA}.sessions WHERE track_id = %s ORDER BY planned_date ASC", (track_id,)
        )
        sessions = cur.fetchall()
    out = _track_dict(row)
    out["sessions"] = [_session_dict(s) for s in sessions]
    return out


@router.get("/timeline")
async def get_timeline():
    """Planned and actual chronologies, kept distinct. Replaying/repairing
    only ever appends `actual` rows - `planned` rows are never rewritten."""
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT t.* FROM {SCHEMA}.timeline_entries t LEFT JOIN {SCHEMA}.sessions s "
            "ON s.id = t.session_id WHERE (s.track_id LIKE 'track-course-%' OR s.track_id LIKE 'track-domain-%' OR s.track_id LIKE 'track-user-%' OR t.session_id IS NULL) "
            "AND t.source = 'planned' ORDER BY t.created_at ASC"
        )
        planned = cur.fetchall()
        cur.execute(
            f"SELECT t.* FROM {SCHEMA}.timeline_entries t LEFT JOIN {SCHEMA}.sessions s "
            "ON s.id = t.session_id WHERE (s.track_id LIKE 'track-course-%' OR s.track_id LIKE 'track-domain-%' OR s.track_id LIKE 'track-user-%' OR t.session_id IS NULL) "
            "AND t.source = 'actual' ORDER BY t.created_at ASC"
        )
        actual = cur.fetchall()
    return {"planned": [dict(r) for r in planned], "actual": [dict(r) for r in actual]}


@router.get("/sessions")
async def list_sessions():
    """All course lesson sessions, most recently touched subject first and, inside
    a subject, in the course plan's own order. Backs the lesson picker on the
    Aula page: a learner studying more than one subject can switch between them,
    and each option says where it sits in the plan ("Aula 7 de 16") instead of
    reading as an arbitrary list."""
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT s.*, t.title AS track_title FROM {SCHEMA}.sessions s "
            f"LEFT JOIN {SCHEMA}.tracks t ON t.id = s.track_id "
            "WHERE (s.track_id LIKE 'track-course-%' OR s.track_id LIKE 'track-domain-%' OR s.track_id LIKE 'track-user-%') "
            "ORDER BY COALESCE(s.actual_date, s.planned_date) DESC, s.updated_at DESC"
        )
        rows = cur.fetchall()
        targets = []
        course_ids: set[str] = set()
        for row in rows:
            course_id, lesson_id = _session_target(row["id"])
            if course_id:
                course_ids.add(course_id)
            targets.append((row, course_id, lesson_id))
        plan = _session_plan_map(cur, course_ids)
    sessions = []
    for row, course_id, lesson_id in targets:
        entry = plan.get(f"{course_id}|{lesson_id}") or {}
        sessions.append(
            {
                **_session_dict(row),
                "track_title": row.get("track_title"),
                "course_id": course_id,
                "plan_position": entry.get("position"),
                "plan_total": entry.get("total"),
                "sequence_label": entry.get("label"),
            }
        )
    return {"sessions": _order_sessions_by_plan(sessions)}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.sessions WHERE id = %s", (session_id,))
        row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="session not found")
    session = _session_dict(row)
    course_id, lesson_id = _session_target(session_id)
    if not course_id or not lesson_id or not session.get("portal_path"):
        return session
    with _connect() as conn, conn.cursor() as cur:
        plan = _session_plan_map(cur, {course_id})
    position = (plan.get(f"{course_id}|{lesson_id}") or {}).get("position")
    session["video_sources"] = _lesson_video_sources(
        _read_portal_html(session["portal_path"]), position,
    )
    return session


@router.get("/metrics")
async def get_metrics():
    """General progress metrics: study minutes and exercise counts broken
    down by course/track, a weekly programmatic calendar (planned vs actual
    sessions per weekday), and course completion percentages. Backs the
    Métricas dashboard page."""
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT s.*, t.title AS track_title, t.stage AS track_stage "
            f"FROM {SCHEMA}.sessions s LEFT JOIN {SCHEMA}.tracks t ON t.id = s.track_id "
            "WHERE (s.track_id LIKE 'track-course-%' OR s.track_id LIKE 'track-domain-%' OR s.track_id LIKE 'track-user-%') ORDER BY COALESCE(s.actual_date, s.planned_date) ASC"
        )
        sessions = [dict(r) for r in cur.fetchall()]
        cur.execute(f"SELECT * FROM {SCHEMA}.courses")
        courses = {r["id"]: dict(r) for r in cur.fetchall()}
        cur.execute(f"SELECT * FROM {SCHEMA}.course_lessons")
        lessons = [dict(r) for r in cur.fetchall()]
        cur.execute(f"SELECT course_id, lesson_id, state FROM {SCHEMA}.lesson_progress")
        lesson_progress = {
            (r["course_id"], r["lesson_id"]): r["state"]
            for r in cur.fetchall()
        }
        cur.execute(
            f"SELECT a.*, s.track_id AS session_track_id FROM {SCHEMA}.assessments a "
            f"LEFT JOIN {SCHEMA}.sessions s ON s.id = a.session_id"
        )
        assessments = [dict(r) for r in cur.fetchall()]

    weekday_names = ["Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado", "Domingo"]
    by_track: dict[str, dict] = {}
    total_minutes_real = 0
    total_minutes_planned = 0
    weekday_counts = {name: {"planned": 0, "actual": 0} for name in weekday_names}
    for s in sessions:
        track_id = s.get("track_id") or "sem-trilha"
        track_title = s.get("track_title") or "Sem trilha"
        entry = by_track.setdefault(track_id, {
            "track_id": track_id, "title": track_title, "stage": s.get("track_stage"),
            "sessions_total": 0, "sessions_completed": 0,
            "minutes_real": 0, "minutes_planned": 0, "exercises_done": 0, "exercises_total": 0,
        })
        entry["sessions_total"] += 1
        if s.get("status") == "completed":
            entry["sessions_completed"] += 1
        actual_dur = s.get("actual_duration") or 0
        planned_dur = s.get("planned_duration") or 0
        entry["minutes_real"] += actual_dur
        entry["minutes_planned"] += planned_dur
        total_minutes_real += actual_dur
        total_minutes_planned += planned_dur
        for date_str, bucket in ((s.get("planned_date"), "planned"), (s.get("actual_date"), "actual")):
            if not date_str:
                continue
            try:
                weekday = datetime.fromisoformat(date_str[:10]).weekday()
                weekday_counts[weekday_names[weekday]][bucket] += 1
            except (ValueError, IndexError):
                pass

    for a in assessments:
        track_id = a.get("session_track_id") or "sem-trilha"
        entry = by_track.get(track_id)
        if entry is None:
            continue
        entry["exercises_total"] += 1
        if a.get("status") in ("corrected", "passed", "completed"):
            entry["exercises_done"] += 1

    course_progress = []
    for course_id, course in courses.items():
        course_lessons = [l for l in lessons if l.get("course_id") == course_id]
        ready_lessons = [l for l in course_lessons if l.get("publication") == "ready"]
        completed = sum(
            1 for lesson in ready_lessons
            if lesson_progress.get((course_id, lesson["id"])) == "completed"
        )
        viewed = sum(
            1 for lesson in ready_lessons
            if lesson_progress.get((course_id, lesson["id"])) == "viewed"
        )
        ready_total = len(ready_lessons)
        course_progress.append({
            "course_id": course_id, "title": course.get("title"),
            "lessons_total": len(course_lessons), "lessons_ready": ready_total,
            "lessons_completed": completed, "lessons_viewed": viewed,
            "lessons_pending": max(0, ready_total - completed - viewed),
            "percent": round(completed / ready_total * 100) if ready_total else 0,
        })

    tracks_out = sorted(by_track.values(), key=lambda t: -(t["minutes_real"] + t["sessions_total"]))
    return {
        "totals": {
            "minutes_real": total_minutes_real,
            "minutes_planned": total_minutes_planned,
            "sessions_total": len(sessions),
            "sessions_completed": sum(1 for s in sessions if s.get("status") == "completed"),
            "exercises_done": sum(t["exercises_done"] for t in by_track.values()),
            "exercises_total": sum(t["exercises_total"] for t in by_track.values()),
        },
        "by_track": tracks_out,
        "weekday_calendar": [
            {"weekday": name, **weekday_counts[name]} for name in weekday_names
        ],
        "courses": course_progress,
    }


@router.get("/sessions/{session_id}/portal")
async def get_session_portal(session_id: str):
    """Return a rendered lesson document from the SSH backend.

    The Desktop renderer receives this HTML through the authenticated API; it
    must never navigate to the server process' 127.0.0.1 address, which is a
    different machine when connected through SSH.
    """
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT portal_path FROM {SCHEMA}.sessions WHERE id = %s", (session_id,))
        row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="session not found")
    html = _read_portal_html(row.get("portal_path"))
    # The material server lives on the SSH backend. The Desktop asks its SSH
    # bridge to forward this URL before assigning it to the iframe, giving
    # embedded media a genuine HTTP origin instead of an opaque srcdoc origin.
    result = {"html": html}
    try:
        result["server_portal_url"] = material_server.material_url(f"session:{session_id}")
    except RuntimeError:
        # Keep the authenticated HTML route usable while the material server
        # starts or when the backend has no direct HTTP listener.
        pass
    return result


def _course_dict(row: dict) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "goal": row.get("goal"),
        "vision": row.get("vision"),
        "depth": row.get("depth"),
        "length": row.get("length"),
        "chapters": json.loads(row.get("chapters_json") or "[]"),
        "sources": json.loads(row.get("sources_json") or "{}"),
        "updated_at": row.get("updated_at"),
    }


def _course_lesson_dict(row: dict) -> dict:
    return {
        "id": row["id"],
        "course_id": row["course_id"],
        "chapter_id": row.get("chapter_id"),
        "topic_id": row.get("topic_id"),
        "title": row["title"],
        "purpose": row.get("purpose"),
        "teacher": row.get("teacher"),
        "concepts": json.loads(row.get("concepts_json") or "[]"),
        "blocks": json.loads(row.get("blocks_json") or "[]"),
        "exercises": json.loads(row.get("exercises_json") or "[]"),
        "publication": row.get("publication"),
        "portal_path": row.get("portal_path"),
        "updated_at": row.get("updated_at"),
    }


def _course_artifact_dict(row: dict) -> dict:
    return {
        "id": row["id"],
        "course_id": row["course_id"],
        "chapter_id": row.get("chapter_id"),
        "topic_id": row.get("topic_id"),
        "lesson_id": row.get("lesson_id"),
        "type": row["type"],
        "title": row["title"],
        "purpose": row.get("purpose"),
        "location": json.loads(row.get("location_json") or "{}"),
        "mime_type": row.get("mime_type"),
        "status": row.get("status"),
        "updated_at": row.get("updated_at"),
    }


_LESSON_STATES = ("viewed", "completed")


def _authored_lesson_order(lessons: list[dict], chapters: list[dict]) -> list[dict]:
    """Order lessons the way the course plan authored them.

    `chapters_json` is the author's source of truth for sequence
    (chapter -> topic -> lesson_ids). Lessons that a later sync wrote but the
    plan does not mention keep their relative order at the end. Without this
    the API returned heap order, which is why every lesson looked
    interchangeabe in the reader ("nobody knows which one is first").
    """
    by_id = {lesson["id"]: lesson for lesson in lessons}
    ordered: list[dict] = []
    seen: set[str] = set()
    for chapter in chapters or []:
        for topic in (chapter or {}).get("topics") or []:
            for lesson_id in (topic or {}).get("lesson_ids") or []:
                lesson = by_id.get(lesson_id)
                if lesson is not None and lesson_id not in seen:
                    seen.add(lesson_id)
                    ordered.append(lesson)
    for lesson in lessons:
        if lesson["id"] not in seen:
            ordered.append(lesson)
    return ordered


def _session_target(session_id: str) -> tuple[Optional[str], Optional[str]]:
    """(course_id, lesson_id) carried by a course-lesson session id.

    Course lesson sessions are named `session-<course_id>-<lesson_id>`, and the
    lesson id is the `lesson-topic-...` key shared by `course_lessons` and the
    plan's `lesson_ids`. The table has no lesson_id column, so the session name
    is the only link between a session and the plan.
    """
    course_head, sep, lesson_tail = (session_id or "").partition("-lesson-topic-")
    if not sep or not course_head.startswith("session-"):
        return None, None
    return course_head[len("session-") :], f"lesson-topic-{lesson_tail}"


def _session_plan_map(cur, course_ids: set[str]) -> dict[str, dict]:
    """Where each lesson sits in its course plan, keyed by f"{course_id}|{lesson_id}".

    Numbering follows the sequence the reader serves (plan order first, then
    lessons the plan does not name yet), so the picker, the Curso tab and the
    reader all say "Aula N de M" with the same M — a draft the plan has not
    absorbed gets the number and an explicit "(planejada)" so it never reads as
    part of the published course.
    """
    plan: dict[str, dict] = {}
    for course_id in sorted(course_ids):
        cur.execute(f"SELECT * FROM {SCHEMA}.courses WHERE id = %s", (course_id,))
        course_row = cur.fetchone()
        if course_row is None:
            continue
        cur.execute(
            f"SELECT * FROM {SCHEMA}.course_lessons WHERE course_id = %s ORDER BY updated_at ASC",
            (course_id,),
        )
        lessons = _authored_lesson_order(
            [_course_lesson_dict(r) for r in cur.fetchall()],
            _course_dict(course_row)["chapters"],
        )
        total = len(lessons)
        for position, lesson in enumerate(lessons):
            label = f"Aula {position + 1} de {total}"
            in_plan = _lesson_in_plan(lesson["id"], _course_dict(course_row)["chapters"])
            if not in_plan:
                label += " (planejada)"
            plan[f"{course_id}|{lesson['id']}"] = {
                "position": position + 1,
                "total": total,
                "label": label,
                "in_plan": in_plan,
            }
    return plan


def _lesson_in_plan(lesson_id: str, chapters: list[dict]) -> bool:
    """True when the course plan (chapter -> topic -> lesson_ids) names this lesson."""
    for chapter in chapters or []:
        for topic in (chapter or {}).get("topics") or []:
            if lesson_id in ((topic or {}).get("lesson_ids") or []):
                return True
    return False


def _order_sessions_by_plan(sessions: list[dict]) -> list[dict]:
    """Subject you touched last stays on top; inside a subject, follow the plan.

    Newest-first alone made the picker look unordered: every lesson of one course
    shared a date, so the tie broke on `updated_at` and the list came back in
    reverse reading order, which reads as a wrong sequence.
    """
    groups: dict[str, list[dict]] = {}
    for session in sessions:
        groups.setdefault(session.get("track_id") or "", []).append(session)
    ordered: list[dict] = []
    for bucket in groups.values():
        planned = [s for s in bucket if s.get("plan_position")]
        unplanned = [s for s in bucket if not s.get("plan_position")]
        planned.sort(key=lambda s: s["plan_position"])
        ordered.extend(planned + unplanned)
    return ordered


def _lesson_progress_map(cur, course_id: str) -> dict[str, dict]:
    """Per-lesson reading state for a course, keyed by lesson id."""
    try:
        cur.execute(
            f"SELECT lesson_id, state, viewed_at, completed_at, source, updated_at "
            f"FROM {SCHEMA}.lesson_progress WHERE course_id = %s",
            (course_id,),
        )
        rows = cur.fetchall()
    except psycopg.errors.UndefinedTable:
        log.warning("lesson_progress missing; run db/migrations/007_lesson_progress.sql")
        return {}
    return {
        row["lesson_id"]: {
            "state": row["state"],
            "viewed_at": row.get("viewed_at"),
            "completed_at": row.get("completed_at"),
            "source": row.get("source"),
            "updated_at": row.get("updated_at"),
        }
        for row in rows
    }


def _progress_summary(lessons: list[dict], progress: dict[str, dict]) -> dict:
    completed = sum(1 for item in lessons if (progress.get(item["id"]) or {}).get("state") == "completed")
    viewed = sum(1 for item in lessons if (progress.get(item["id"]) or {}).get("state") == "viewed")
    total = len(lessons)
    return {"total": total, "completed": completed, "viewed": viewed, "pending": max(0, total - completed - viewed)}


def _viewer_state(course_row: dict, lessons: list[dict], progress: dict[str, dict], lesson_id: str, portal_html: str) -> dict:
    """Sequence + progress payload handed to the portal viewer layer."""
    mapping = portal_viewer.map_lessons_to_portal(portal_html, [dict(item) for item in lessons])
    titles = {item["id"]: item.get("title") for item in lessons}
    try:
        focus = mapping.index(lesson_id)
    except ValueError:
        focus = 0
    return {
        "courseId": course_row["id"],
        "courseTitle": course_row.get("title"),
        "lessonIds": mapping,
        "titles": [titles.get(mapped) for mapped in mapping],
        "progress": {mid: (progress.get(mid) or {}).get("state") for mid in mapping if mid},
        "focusIndex": focus,
        "total": len(mapping),
    }


class LessonProgressPayload(BaseModel):
    state: str = Field(default="viewed")
    source: Optional[str] = None


@router.post("/courses/{course_id}/lessons/{lesson_id}/progress")
async def set_lesson_progress(course_id: str, lesson_id: str, payload: LessonProgressPayload):
    """Record that a lesson was read (`viewed`) or finished (`completed`).

    This is what answers "how does the system know the lesson was consulted?":
    the reader posts `viewed` whenever a lesson becomes current and
    `completed` when the student confirms it. State never downgrades, so
    reopening a finished lesson keeps `completed` and its original timestamp.
    """
    state = (payload.state or "").strip().lower()
    if state not in _LESSON_STATES:
        raise HTTPException(status_code=422, detail="state must be 'viewed' or 'completed'")
    now = _now()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT id FROM {SCHEMA}.courses WHERE id = %s", (course_id,))
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="course not found")
        cur.execute(
            f"SELECT id FROM {SCHEMA}.course_lessons WHERE course_id = %s AND id = %s",
            (course_id, lesson_id),
        )
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="lesson not found")
        cur.execute(
            f"SELECT state, viewed_at, completed_at FROM {SCHEMA}.lesson_progress "
            f"WHERE course_id = %s AND lesson_id = %s",
            (course_id, lesson_id),
        )
        current = cur.fetchone() or {}
        viewed_at = current.get("viewed_at") or now
        completed_at = current.get("completed_at")
        if state == "completed":
            completed_at = completed_at or now
            final_state = "completed"
        else:
            final_state = current.get("state") or "viewed"
        cur.execute(
            f"""INSERT INTO {SCHEMA}.lesson_progress
                    (course_id, lesson_id, state, viewed_at, completed_at, source, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (course_id, lesson_id) DO UPDATE SET
                    state = EXCLUDED.state,
                    viewed_at = EXCLUDED.viewed_at,
                    completed_at = EXCLUDED.completed_at,
                    source = EXCLUDED.source,
                    updated_at = EXCLUDED.updated_at""",
            (course_id, lesson_id, final_state, viewed_at, completed_at, payload.source, now),
        )
        conn.commit()
        cur.execute(
            f"SELECT id FROM {SCHEMA}.course_lessons WHERE course_id = %s",
            (course_id,),
        )
        ids = [row["id"] for row in cur.fetchall()]
        progress = _lesson_progress_map(cur, course_id)
    return {
        "course_id": course_id,
        "lesson_id": lesson_id,
        "state": final_state,
        "viewed_at": viewed_at,
        "completed_at": completed_at,
        "summary": _progress_summary([{"id": i} for i in ids], progress),
    }


@router.get("/assessments")

@router.get("/courses")
async def list_courses():
    """All synced courses, for the Trilha screen's course/module drill-down."""
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.courses ORDER BY updated_at DESC")
        rows = cur.fetchall()
    return {"courses": [_course_dict(r) for r in rows]}


@router.get("/courses/{course_id}")
async def get_course(course_id: str):
    """Full course tree: chapters/topics (from the course plan) plus every
    synced lesson and artifact under it, so the desktop UI can render
    Curso -> Capítulo -> Tópico -> Aula -> Exercícios/Artefatos without a
    second round trip per level."""
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.courses WHERE id = %s", (course_id,))
        course_row = cur.fetchone()
        if course_row is None:
            raise HTTPException(status_code=404, detail="course not found")
        cur.execute(
            f"SELECT * FROM {SCHEMA}.course_lessons WHERE course_id = %s ORDER BY updated_at ASC",
            (course_id,),
        )
        lessons = _authored_lesson_order(
            [_course_lesson_dict(r) for r in cur.fetchall()],
            _course_dict(course_row)["chapters"],
        )
        cur.execute(
            f"SELECT * FROM {SCHEMA}.course_artifacts WHERE course_id = %s ORDER BY updated_at ASC",
            (course_id,),
        )
        artifacts = [_course_artifact_dict(r) for r in cur.fetchall()]
        progress = _lesson_progress_map(cur, course_id)
    total = len(lessons)
    for position, lesson in enumerate(lessons):
        entry = progress.get(lesson["id"]) or {}
        lesson["position"] = position + 1
        lesson["sequence_label"] = f"Aula {position + 1} de {total}"
        lesson["progress_state"] = entry.get("state") or "pending"
        lesson["progress"] = entry or None
    return {
        **_course_dict(course_row),
        "lessons": lessons,
        "artifacts": artifacts,
        "progress": _progress_summary(lessons, progress),
    }


def _material_course_root(course_id: str) -> tuple[Path, str]:
    """(course root, portal path inside it) for the loopback material origin.

    `course_id` doubles as a session key: a `session:<id>` prefix resolves
    against `sessions.portal_path` instead of `course_lessons.portal_path`,
    so `/sessions/{id}/portal` can mint the same real-origin transport that
    the course/lesson portal route uses (a `data:` transport gives an
    embedded video an opaque origin, which YouTube's player rejects with
    Erro 153)."""
    if course_id.startswith("session:"):
        session_id = course_id[len("session:"):]
        with _connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"SELECT portal_path FROM {SCHEMA}.sessions WHERE id = %s",
                (session_id,),
            )
            row = cur.fetchone()
        if row is None or not row["portal_path"]:
            raise HTTPException(status_code=404, detail="portal not found")
        portal = Path(row["portal_path"]).resolve()
        return portal.parent.parent, str(portal.relative_to(portal.parent.parent))
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT portal_path FROM {SCHEMA}.course_lessons "
            "WHERE course_id = %s AND portal_path IS NOT NULL "
            "ORDER BY updated_at ASC LIMIT 1",
            (course_id,),
        )
        row = cur.fetchone()
    if row is None or not row["portal_path"]:
        raise HTTPException(status_code=404, detail="portal not found")
    portal = Path(row["portal_path"]).resolve()
    return portal.parent.parent, str(portal.relative_to(portal.parent.parent))


def _material_render_entry(course_id: str, lesson_id: str, html: str) -> str:
    """Viewer layer for a served portal: sequence, one lesson at a time, OK, progress.

    A `session:<id>` key (see `_material_course_root`) has no course/lesson
    sequence to inject — a standalone session document is served as-is."""
    if course_id.startswith("session:"):
        return html
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.courses WHERE id = %s", (course_id,))
        course_row = cur.fetchone()
        if course_row is None:
            raise HTTPException(status_code=404, detail="course not found")
        cur.execute(
            f"SELECT * FROM {SCHEMA}.course_lessons WHERE course_id = %s ORDER BY updated_at ASC",
            (course_id,),
        )
        lessons = _authored_lesson_order(
            [_course_lesson_dict(r) for r in cur.fetchall()],
            _course_dict(course_row)["chapters"],
        )
        progress = _lesson_progress_map(cur, course_id)
    if not any(item["id"] == lesson_id for item in lessons):
        lesson_id = lessons[0]["id"] if lessons else ""
    state = _viewer_state(course_row, lessons, progress, lesson_id, html)
    return portal_viewer.inject_course_viewer(html, state)


material_server.set_resolver(_material_course_root)
material_server.set_entry_renderer(_material_render_entry)


@router.get("/courses/{course_id}/lessons/{lesson_id}/portal")
async def get_course_lesson_portal(course_id: str, lesson_id: str):
    """Same contract as `/sessions/{id}/portal`, for lessons reached via the
    Trilha screen's course/module drill-down (CourseExplorer) rather than
    the daily session picker. Both tables carry their own `portal_path`
    written by sync_evidence.py at publish time."""
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.courses WHERE id = %s", (course_id,))
        course_row = cur.fetchone()
        if course_row is None:
            raise HTTPException(status_code=404, detail="course not found")
        cur.execute(
            f"SELECT * FROM {SCHEMA}.course_lessons WHERE course_id = %s ORDER BY updated_at ASC",
            (course_id,),
        )
        lessons = _authored_lesson_order(
            [_course_lesson_dict(r) for r in cur.fetchall()],
            _course_dict(course_row)["chapters"],
        )
        progress = _lesson_progress_map(cur, course_id)
    lesson = next((item for item in lessons if item["id"] == lesson_id), None)
    if lesson is None:
        raise HTTPException(status_code=404, detail="lesson not found")
    html = _read_portal_html(lesson.get("portal_path"))
    state = _viewer_state(course_row, lessons, progress, lesson_id, html)
    rendered = portal_viewer.inject_course_viewer(html, state)
    # The material endpoint remains on the SSH server; the Desktop forwards it
    # before using it as an iframe source so YouTube receives an HTTP Referer.
    result = {
        "course_id": course_id,
        "lesson_id": lesson_id,
        "position": state["focusIndex"] + 1,
        "total": len(lessons),
        "progress_state": (progress.get(lesson_id) or {}).get("state") or "pending",
        "html": rendered,
    }
    try:
        result["server_portal_url"] = material_server.material_url(course_id, lesson_id)
    except RuntimeError:
        pass
    return result


@router.get("/assessments")
async def list_assessments():
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT * FROM {SCHEMA}.assessments WHERE id LIKE 'assessment-course-%' ORDER BY created_at ASC"
        )
        rows = cur.fetchall()
    return {"assessments": [_assessment_dict(r) for r in rows]}


@router.get("/evidence")
async def list_evidence():
    """Also serves as the 'progress' tree the dashboard renders as a drill-down."""
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT * FROM {SCHEMA}.evidence WHERE id LIKE 'evidence-course-%' "
            "ORDER BY depth ASC, updated_at ASC"
        )
        rows = cur.fetchall()
    return {"evidence": [_evidence_dict(r) for r in rows]}


@router.get("/evidence/{competency_id}/history")
async def get_evidence_history(competency_id: str):
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT * FROM {SCHEMA}.evidence_history WHERE competency_id = %s ORDER BY recorded_at ASC",
            (competency_id,),
        )
        history = [dict(row) for row in cur.fetchall()]
    return {"competency_id": competency_id, "history": history, "total": len(history)}


@router.get("/resources")
async def list_resources():
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT * FROM {SCHEMA}.resources WHERE id LIKE 'resource-course-%' ORDER BY created_at ASC"
        )
        rows = cur.fetchall()
    return {"resources": [dict(r) for r in rows]}


@router.get("/library")
async def list_library(page: int = 1, page_size: int = 12, folder_id: Optional[str] = None, q: Optional[str] = None, kind: Optional[str] = None):
    """Hierarchical, paginated library of course sources and study resources.

    Sources live in each course's structured ``sources_json``; resources live
    in the plugin table. This endpoint exposes both through stable folder IDs
    without duplicating the underlying records. ``folder_id`` selects one
    subject/course folder and pagination is applied only to its entries.
    """
    _ensure_seeded()
    page = max(1, min(int(page), 100000))
    page_size = max(1, min(int(page_size), 50))
    records: list[dict[str, Any]] = []
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT id, title, sources_json FROM {SCHEMA}.courses ORDER BY title ASC")
        course_rows = [dict(row) for row in cur.fetchall()]
        cur.execute(f"SELECT * FROM {SCHEMA}.resources ORDER BY created_at ASC")
        resources = [dict(row) for row in cur.fetchall()]
        cur.execute(f"SELECT item_id FROM {SCHEMA}.library_favorites")
        favorite_ids = {row["item_id"] for row in cur.fetchall()}

    course_titles = {str(course["id"]): course.get("title") or course["id"] for course in course_rows}
    for course in course_rows:
        course_id = str(course["id"])
        folder = f"sources:{course_id}"
        sources = json.loads(course.get("sources_json") or "{}")
        for source_id, source in sources.items():
            if not isinstance(source, dict):
                continue
            records.append({
                "id": f"source:{course_id}:{source_id}",
                "kind": "source",
                "folder_id": folder,
                "folder_type": "sources",
                "subject_id": course_id,
                "subject_title": course.get("title") or course_id,
                "title": source.get("title") or source_id,
                "detail": source.get("verification_notes") or source.get("type") or "Fonte de estudo",
                "url": source.get("url"),
                "provenance": source.get("type") or "course-authored",
                "favorite": f"source:{course_id}:{source_id}" in favorite_ids,
            })
    for resource in resources:
        resource_course = resource.get("course_id")
        folder = f"resources:{resource_course}" if resource_course else "resources:general"
        subject_title = course_titles.get(str(resource_course), "Recursos gerais") if resource_course else "Recursos gerais"
        records.append({
            **resource,
            "kind": "resource",
            "folder_id": folder,
            "folder_type": "resources",
            "subject_id": resource_course,
            "subject_title": subject_title,
            "favorite": resource["id"] in favorite_ids,
        })

    if q and q.strip():
        needle = q.strip().casefold()
        records = [record for record in records if needle in " ".join(
            str(record.get(field) or "") for field in ("title", "detail", "subject_title")
        ).casefold()]
    if kind in {"source", "resource"}:
        records = [record for record in records if record.get("kind") == kind]

    folder_map: dict[str, dict[str, Any]] = {}
    for record in records:
        folder_key = record["folder_id"]
        folder = folder_map.setdefault(folder_key, {
            "id": folder_key,
            "type": record["folder_type"],
            "title": ("Fontes · " if record["folder_type"] == "sources" else "Recursos · ") + record["subject_title"],
            "subject_id": record.get("subject_id"),
            "subject_title": record["subject_title"],
            "count": 0,
        })
        folder["count"] += 1
    folders = sorted(folder_map.values(), key=lambda folder: (folder["type"], folder["title"].lower()))
    selected = folder_id if folder_id in folder_map else (folders[0]["id"] if folders else None)
    selected_records = [record for record in records if record["folder_id"] == selected]
    selected_records.sort(key=lambda record: (str(record.get("title") or "").lower(), str(record.get("id"))))
    total = len(selected_records)
    start = (page - 1) * page_size
    items = selected_records[start:start + page_size]
    return {
        "folders": folders,
        "selected_folder": selected,
        "items": items,
        "page": page,
        "page_size": page_size,
        "total": total,
        "has_more": start + page_size < total,
    }


@router.post("/library/favorites/{item_id:path}")
async def favorite_library_item(item_id: str):
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {SCHEMA}.library_favorites (item_id, created_at) VALUES (%s, %s) ON CONFLICT (item_id) DO NOTHING",
            (item_id, _now()),
        )
        conn.commit()
    return {"item_id": item_id, "favorite": True}


@router.delete("/library/favorites/{item_id:path}")
async def unfavorite_library_item(item_id: str):
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"DELETE FROM {SCHEMA}.library_favorites WHERE item_id = %s", (item_id,))
        conn.commit()
    return {"item_id": item_id, "favorite": False}


@router.patch("/library/resources/{resource_id}/associations")
async def update_resource_associations(resource_id: str, body: ResourceAssociationBody):
    _ensure_seeded()
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="nenhuma associação informada")
    assignments = ", ".join(f"{name} = %s" for name in fields)
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"UPDATE {SCHEMA}.resources SET {assignments} WHERE id = %s RETURNING *",
            (*fields.values(), resource_id),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="resource not found")
        conn.commit()
    return {"resource": dict(row)}


@router.post("/sessions/{session_id}/resources/{resource_id}")
async def record_session_resource(session_id: str, resource_id: str):
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT 1 FROM {SCHEMA}.sessions WHERE id = %s", (session_id,))
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="session not found")
        cur.execute(f"SELECT 1 FROM {SCHEMA}.resources WHERE id = %s", (resource_id,))
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="resource not found")
        cur.execute(
            f"INSERT INTO {SCHEMA}.session_resources (session_id, resource_id, used_at) VALUES (%s, %s, %s) "
            "ON CONFLICT (session_id, resource_id) DO UPDATE SET used_at = EXCLUDED.used_at",
            (session_id, resource_id, _now()),
        )
        conn.commit()
    return {"session_id": session_id, "resource_id": resource_id, "recorded": True}


@router.get("/sessions/{session_id}/resources")
async def list_session_resources(session_id: str):
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT 1 FROM {SCHEMA}.sessions WHERE id = %s", (session_id,))
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="session not found")
        cur.execute(
            f"SELECT r.*, sr.used_at FROM {SCHEMA}.session_resources sr "
            f"JOIN {SCHEMA}.resources r ON r.id = sr.resource_id "
            "WHERE sr.session_id = %s ORDER BY sr.used_at ASC",
            (session_id,),
        )
        resources = [dict(row) for row in cur.fetchall()]
    return {"session_id": session_id, "resources": resources, "total": len(resources)}


@router.get("/labs")
async def list_labs():
    """List available labs so the renderer never depends on a fixture id."""
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT l.* FROM {SCHEMA}.labs l JOIN {SCHEMA}.sessions s ON s.id = l.session_id "
            "WHERE (s.track_id LIKE 'track-course-%' OR s.track_id LIKE 'track-domain-%' OR s.track_id LIKE 'track-user-%') ORDER BY l.created_at ASC"
        )
        rows = cur.fetchall()
    return {"labs": [_lab_dict(r) for r in rows]}


@router.get("/labs/{lab_id}")
async def get_lab(lab_id: str):
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.labs WHERE id = %s", (lab_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="lab not found")
        cur.execute(
            f"SELECT * FROM {SCHEMA}.lab_checks WHERE lab_id = %s ORDER BY created_at ASC", (lab_id,)
        )
        checks = cur.fetchall()
    out = _lab_dict(row)
    out["checks"] = [dict(c) for c in checks]
    return out


class TrackCreateBody(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    stage: str = Field(default="Em planejamento", max_length=120)
    status: str = Field(default="unknown", max_length=40)
    detail: Optional[str] = Field(default=None, max_length=500)


class TrackUpdateBody(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=180)
    stage: Optional[str] = Field(default=None, max_length=120)
    status: Optional[str] = Field(default=None, max_length=40)
    detail: Optional[str] = Field(default=None, max_length=500)


class SessionUpdateBody(BaseModel):
    planned_date: Optional[str] = Field(default=None, max_length=30)
    planned_topic: Optional[str] = Field(default=None, max_length=300)
    planned_duration: Optional[int] = Field(default=None, ge=1, le=1440)


class SessionNoteBody(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


class ResourceAssociationBody(BaseModel):
    folder_id: Optional[str] = Field(default=None, max_length=180)
    lesson_id: Optional[str] = Field(default=None, max_length=180)
    competency_id: Optional[str] = Field(default=None, max_length=180)


PROJECT_STATUSES = {"planned", "in_progress", "blocked", "completed", "archived"}
MILESTONE_STATUSES = {"planned", "in_progress", "completed"}


class ProjectCreateBody(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    objective: Optional[str] = Field(default=None, max_length=2000)
    competencies: list[str] = Field(default_factory=list, max_length=30)
    next_step: Optional[str] = Field(default=None, max_length=1000)


class ProjectUpdateBody(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=180)
    objective: Optional[str] = Field(default=None, max_length=2000)
    competencies: Optional[list[str]] = Field(default=None, max_length=30)
    status: Optional[str] = Field(default=None, max_length=40)
    next_step: Optional[str] = Field(default=None, max_length=1000)


class ProjectMilestoneCreateBody(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    due_date: Optional[str] = Field(default=None, max_length=30)


class ProjectMilestoneUpdateBody(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=300)
    status: Optional[str] = Field(default=None, max_length=40)
    due_date: Optional[str] = Field(default=None, max_length=30)


class ProjectActivityCreateBody(BaseModel):
    text: str = Field(min_length=1, max_length=5000)


class ProjectEvidenceCreateBody(BaseModel):
    label: str = Field(min_length=1, max_length=300)
    url: Optional[str] = Field(default=None, max_length=2000)
    detail: Optional[str] = Field(default=None, max_length=5000)


def _load_project_detail(cur, project_id: str) -> tuple[dict, list[dict], list[dict], list[dict]]:
    cur.execute(f"SELECT * FROM {SCHEMA}.projects WHERE id = %s", (project_id,))
    project = cur.fetchone()
    if project is None:
        raise HTTPException(status_code=404, detail="project not found")
    cur.execute(f"SELECT * FROM {SCHEMA}.project_milestones WHERE project_id = %s ORDER BY created_at ASC", (project_id,))
    milestones = [dict(row) for row in cur.fetchall()]
    cur.execute(f"SELECT * FROM {SCHEMA}.project_activities WHERE project_id = %s ORDER BY created_at DESC", (project_id,))
    activities = [dict(row) for row in cur.fetchall()]
    cur.execute(f"SELECT * FROM {SCHEMA}.project_evidence WHERE project_id = %s ORDER BY created_at DESC", (project_id,))
    evidence = [dict(row) for row in cur.fetchall()]
    return _project_dict(project, milestones), milestones, activities, evidence


@router.get("/projects")
async def list_projects():
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.projects ORDER BY updated_at DESC, created_at DESC")
        rows = cur.fetchall()
        cur.execute(f"SELECT * FROM {SCHEMA}.project_milestones ORDER BY created_at ASC")
        milestones_by_project: dict[str, list[dict]] = {}
        for milestone in cur.fetchall():
            item = dict(milestone)
            milestones_by_project.setdefault(item["project_id"], []).append(item)
    return {"projects": [_project_dict(row, milestones_by_project.get(row["id"], [])) for row in rows]}


@router.get("/projects/{project_id}")
async def get_project(project_id: str):
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        project, milestones, activities, evidence = _load_project_detail(cur, project_id)
    return {"project": project, "milestones": milestones, "activities": activities, "evidence": evidence}


@router.post("/projects")
async def create_project(body: ProjectCreateBody):
    _ensure_seeded()
    now = _now()
    project_id = f"project-user-{uuid.uuid4().hex}"
    competencies = [item.strip() for item in body.competencies if item.strip()]
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {SCHEMA}.projects (id, title, competencies, status, objective, next_step, created_at, updated_at) "
            "VALUES (%s, %s, %s, 'planned', %s, %s, %s, %s) RETURNING *",
            (project_id, body.title.strip(), json.dumps(competencies), body.objective, body.next_step, now, now),
        )
        project = _project_dict(cur.fetchone())
        conn.commit()
    return {"project": project}


@router.patch("/projects/{project_id}")
async def update_project(project_id: str, body: ProjectUpdateBody):
    _ensure_seeded()
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="nenhuma alteração informada")
    if "status" in fields and fields["status"] not in PROJECT_STATUSES:
        raise HTTPException(status_code=422, detail="status de projeto inválido")
    if "competencies" in fields:
        fields["competencies"] = json.dumps([item.strip() for item in fields["competencies"] if item.strip()])
    fields["updated_at"] = _now()
    with _connect() as conn, conn.cursor() as cur:
        _load_project_detail(cur, project_id)
        if fields.get("status") == "completed":
            cur.execute(f"SELECT status FROM {SCHEMA}.project_milestones WHERE project_id = %s", (project_id,))
            milestones = cur.fetchall()
            if not milestones or any(row["status"] != "completed" for row in milestones):
                raise HTTPException(status_code=409, detail="conclua todos os marcos antes de concluir o projeto")
            fields["completed_at"] = fields["updated_at"]
        assignments = ", ".join(f"{name} = %s" for name in fields)
        cur.execute(f"UPDATE {SCHEMA}.projects SET {assignments} WHERE id = %s", (*fields.values(), project_id))
        project, milestones, _, _ = _load_project_detail(cur, project_id)
        conn.commit()
    return {"project": project, "milestones": milestones}


@router.post("/projects/{project_id}/milestones")
async def create_project_milestone(project_id: str, body: ProjectMilestoneCreateBody):
    _ensure_seeded()
    now = _now()
    milestone_id = f"milestone-{uuid.uuid4().hex}"
    with _connect() as conn, conn.cursor() as cur:
        _load_project_detail(cur, project_id)
        cur.execute(
            f"INSERT INTO {SCHEMA}.project_milestones (id, project_id, title, status, due_date, created_at, updated_at) "
            "VALUES (%s, %s, %s, 'planned', %s, %s, %s) RETURNING *",
            (milestone_id, project_id, body.title.strip(), body.due_date, now, now),
        )
        milestone = dict(cur.fetchone())
        cur.execute(f"UPDATE {SCHEMA}.projects SET updated_at = %s WHERE id = %s", (now, project_id))
        conn.commit()
    return {"milestone": milestone}


@router.patch("/projects/{project_id}/milestones/{milestone_id}")
async def update_project_milestone(project_id: str, milestone_id: str, body: ProjectMilestoneUpdateBody):
    _ensure_seeded()
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="nenhuma alteração informada")
    if "status" in fields and fields["status"] not in MILESTONE_STATUSES:
        raise HTTPException(status_code=422, detail="status de marco inválido")
    fields["updated_at"] = _now()
    assignments = ", ".join(f"{name} = %s" for name in fields)
    with _connect() as conn, conn.cursor() as cur:
        _load_project_detail(cur, project_id)
        cur.execute(
            f"UPDATE {SCHEMA}.project_milestones SET {assignments} WHERE id = %s AND project_id = %s RETURNING *",
            (*fields.values(), milestone_id, project_id),
        )
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="milestone not found")
        cur.execute(f"UPDATE {SCHEMA}.projects SET updated_at = %s WHERE id = %s", (fields["updated_at"], project_id))
        conn.commit()
    return {"milestone": dict(row)}


@router.post("/projects/{project_id}/activities")
async def create_project_activity(project_id: str, body: ProjectActivityCreateBody):
    _ensure_seeded()
    now = _now()
    activity_id = f"project-activity-{uuid.uuid4().hex}"
    with _connect() as conn, conn.cursor() as cur:
        _load_project_detail(cur, project_id)
        cur.execute(
            f"INSERT INTO {SCHEMA}.project_activities (id, project_id, text, created_at) VALUES (%s, %s, %s, %s) RETURNING *",
            (activity_id, project_id, body.text.strip(), now),
        )
        activity = dict(cur.fetchone())
        cur.execute(f"UPDATE {SCHEMA}.projects SET updated_at = %s WHERE id = %s", (now, project_id))
        conn.commit()
    return {"activity": activity}


@router.post("/projects/{project_id}/evidence")
async def create_project_evidence(project_id: str, body: ProjectEvidenceCreateBody):
    _ensure_seeded()
    now = _now()
    evidence_id = f"project-evidence-{uuid.uuid4().hex}"
    with _connect() as conn, conn.cursor() as cur:
        _load_project_detail(cur, project_id)
        cur.execute(
            f"INSERT INTO {SCHEMA}.project_evidence (id, project_id, label, url, detail, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s) RETURNING *",
            (evidence_id, project_id, body.label.strip(), body.url, body.detail, now),
        )
        evidence = dict(cur.fetchone())
        cur.execute(f"UPDATE {SCHEMA}.projects SET updated_at = %s WHERE id = %s", (now, project_id))
        conn.commit()
    return {"evidence": evidence}


@router.get("/sessions/{session_id}/notes")
async def list_session_notes(session_id: str):
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT id FROM {SCHEMA}.sessions WHERE id = %s", (session_id,))
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="session not found")
        cur.execute(
            f"SELECT * FROM {SCHEMA}.session_notes WHERE session_id = %s ORDER BY created_at ASC",
            (session_id,),
        )
        notes = [dict(row) for row in cur.fetchall()]
    return {"session_id": session_id, "notes": notes, "total": len(notes)}


@router.post("/sessions/{session_id}/notes")
async def create_session_note(session_id: str, body: SessionNoteBody):
    _ensure_seeded()
    now = _now()
    note_id = f"note-{uuid.uuid4().hex}"
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT id FROM {SCHEMA}.sessions WHERE id = %s", (session_id,))
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="session not found")
        cur.execute(
            f"INSERT INTO {SCHEMA}.session_notes (id, session_id, text, created_at) "
            "VALUES (%s, %s, %s, %s) RETURNING *",
            (note_id, session_id, body.text.strip(), now),
        )
        note = dict(cur.fetchone())
        conn.commit()
    return {"note": note}


@router.post("/tracks")
async def create_track(body: TrackCreateBody):
    _ensure_seeded()
    now = _now()
    track_id = f"track-user-{uuid.uuid4().hex}"
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"INSERT INTO {SCHEMA}.tracks (id, title, stage, status, detail, competencies_json, created_at, updated_at) "
            "VALUES (%s, %s, %s, %s, %s, '[]', %s, %s) RETURNING *",
            (track_id, body.title.strip(), body.stage.strip(), body.status.strip(), body.detail, now, now),
        )
        row = cur.fetchone()
        conn.commit()
    return {"track": _track_dict(row)}


@router.patch("/tracks/{track_id}")
async def update_track(track_id: str, body: TrackUpdateBody):
    _ensure_seeded()
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="nenhuma alteração informada")
    fields["updated_at"] = _now()
    assignments = ", ".join(f"{name} = %s" for name in fields)
    values = list(fields.values()) + [track_id]
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT source_type FROM {SCHEMA}.tracks WHERE id = %s", (track_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="track not found")
        if row["source_type"] != "user":
            raise HTTPException(status_code=409, detail="trilhas sincronizadas não podem ser editadas diretamente")
        cur.execute(f"UPDATE {SCHEMA}.tracks SET {assignments} WHERE id = %s RETURNING *", values)
        row = cur.fetchone()
        conn.commit()
    return {"track": _track_dict(row)}


@router.delete("/tracks/{track_id}")
async def delete_track(track_id: str):
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT source_type FROM {SCHEMA}.tracks WHERE id = %s", (track_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="track not found")
        if row["source_type"] != "user":
            raise HTTPException(status_code=409, detail="trilhas sincronizadas não podem ser apagadas")
        cur.execute(f"DELETE FROM {SCHEMA}.tracks WHERE id = %s", (track_id,))
        conn.commit()
    return {"deleted": track_id}


@router.patch("/sessions/{session_id}")
async def update_planned_session(session_id: str, body: SessionUpdateBody):
    """Edit only future/planned sessions; actual history stays immutable."""
    _ensure_seeded()
    fields = body.model_dump(exclude_unset=True)
    if not fields:
        raise HTTPException(status_code=400, detail="nenhuma alteração informada")
    fields["updated_at"] = _now()
    assignments = ", ".join(f"{name} = %s" for name in fields)
    values = list(fields.values()) + [session_id]
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT status FROM {SCHEMA}.sessions WHERE id = %s", (session_id,))
        existing = cur.fetchone()
        if existing is None:
            raise HTTPException(status_code=404, detail="session not found")
        if existing["status"] != "planned":
            raise HTTPException(status_code=409, detail="sessões iniciadas ou concluídas não podem ser replanejadas")
        cur.execute(f"UPDATE {SCHEMA}.sessions SET {assignments} WHERE id = %s RETURNING *", values)
        row = cur.fetchone()
        conn.commit()
    return {"session": _session_dict(row)}


# --------------------------------------------------------------------------
# POST routes - write actions. Every write is a real state transition on
# a real row; no write is destructive to prior history (timeline_entries and
# attempts are append-only tables).
# --------------------------------------------------------------------------

class SessionCompleteBody(BaseModel):
    actual_topic: Optional[str] = None
    actual_duration: Optional[int] = None
    next_step: Optional[str] = None


@router.post("/sessions/{session_id}/start")
async def start_session(session_id: str):
    _ensure_seeded()
    now = _now()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.sessions WHERE id = %s", (session_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="session not found")
        if row["status"] == "planned":
            cur.execute(
                f"UPDATE {SCHEMA}.sessions SET status = 'in_progress', started_at = %s, updated_at = %s WHERE id = %s",
                (now, now, session_id),
            )
            cur.execute(
                f"INSERT INTO {SCHEMA}.timeline_entries (id, session_id, source, entry_date, kind, text, adaptive_reason, created_at) "
                "VALUES (%s, %s, 'actual', %s, %s, %s, NULL, %s)",
                (str(uuid.uuid4()), session_id, now[:10], row["kind"], f"Sessao iniciada: {row['planned_topic']}", now),
            )
            conn.commit()
        cur.execute(f"SELECT * FROM {SCHEMA}.sessions WHERE id = %s", (session_id,))
        row = cur.fetchone()
    return _session_dict(row)


@router.post("/sessions/{session_id}/complete")
async def complete_session(session_id: str, body: SessionCompleteBody):
    _ensure_seeded()
    now = _now()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.sessions WHERE id = %s", (session_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="session not found")
        if row["status"] == "planned":
            raise HTTPException(status_code=409, detail="inicie a sessão antes de concluí-la")
        if row["status"] == "completed":
            return _session_dict(row)
        actual_topic = body.actual_topic or row["actual_topic"] or row["planned_topic"]
        cur.execute(
            f"UPDATE {SCHEMA}.sessions SET status = 'completed', actual_date = %s, actual_topic = %s, "
            "actual_duration = COALESCE(%s, actual_duration), next_step = COALESCE(%s, next_step), "
            "completed_at = %s, updated_at = %s WHERE id = %s",
            (now[:10], actual_topic, body.actual_duration, body.next_step, now, now, session_id),
        )
        # Older sync rows encode the relation in stable IDs rather than columns:
        # track-course-<course-id> and session-<course-id>-<lesson-id>.
        course_id = row.get("course_id")
        lesson_id = row.get("lesson_id")
        if not course_id and str(row.get("track_id") or "").startswith("track-course-"):
            course_id = str(row["track_id"])[len("track-course-"):]
        if course_id and not lesson_id:
            cur.execute(
                f"SELECT id FROM {SCHEMA}.course_lessons WHERE course_id = %s",
                (course_id,),
            )
            prefix = f"session-{course_id}-"
            lesson_id = next((candidate["id"] for candidate in cur.fetchall() if session_id == prefix + candidate["id"]), None)
        # A session checkmark and its linked course lesson represent the same
        # pedagogical completion. Keep both projections transactional so the
        # schedule and lesson-progress views cannot diverge.
        if course_id and lesson_id:
            cur.execute(
                f"""INSERT INTO {SCHEMA}.lesson_progress
                        (course_id, lesson_id, state, viewed_at, completed_at, source, updated_at)
                    VALUES (%s, %s, 'completed', %s, %s, 'session-checklist', %s)
                    ON CONFLICT (course_id, lesson_id) DO UPDATE SET
                        state = 'completed',
                        viewed_at = COALESCE({SCHEMA}.lesson_progress.viewed_at, EXCLUDED.viewed_at),
                        completed_at = COALESCE({SCHEMA}.lesson_progress.completed_at, EXCLUDED.completed_at),
                        source = EXCLUDED.source,
                        updated_at = EXCLUDED.updated_at""",
                (course_id, lesson_id, now, now, now),
            )
        cur.execute(
            f"INSERT INTO {SCHEMA}.timeline_entries (id, session_id, source, entry_date, kind, text, adaptive_reason, created_at) "
            "VALUES (%s, %s, 'actual', %s, %s, %s, NULL, %s)",
            (str(uuid.uuid4()), session_id, now[:10], row["kind"], f"Sessao concluida: {actual_topic}", now),
        )
        conn.commit()
        cur.execute(f"SELECT * FROM {SCHEMA}.sessions WHERE id = %s", (session_id,))
        row = cur.fetchone()
    return _session_dict(row)


@router.post("/labs/{lab_id}/start")
async def start_lab(lab_id: str):
    _ensure_seeded()
    now = _now()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.labs WHERE id = %s", (lab_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="lab not found")
        cur.execute(
            f"UPDATE {SCHEMA}.labs SET status = 'running', updated_at = %s WHERE id = %s",
            (now, lab_id),
        )
        conn.commit()
        cur.execute(f"SELECT * FROM {SCHEMA}.labs WHERE id = %s", (lab_id,))
        row = cur.fetchone()
    return _lab_dict(row)


def _mock_run_deterministic_checks(lab: dict) -> list[dict]:
    """Restricted MOCK runner (see module docstring): NEVER executes shell.

    Deterministic per lab id - same lab always reproduces the same check
    results, so a demo/test run is reproducible without a real sandbox.
    """
    results = []
    for check in lab.get("deterministic_checks") or []:
        name = check.get("name", "check")
        fixed = "corrigid" in (lab.get("evidence_note") or "").lower()
        passed = fixed
        output = (
            "getent hosts api -> 172.20.0.3 api" if (fixed and name == "web_resolves_api_dns")
            else "curl http://api:8080/health -> 200 OK" if (fixed and name == "web_reaches_api_health")
            else "curl: (6) Could not resolve host: api"
        )
        results.append({"name": name, "passed": passed, "output": output})
    return results


@router.post("/labs/{lab_id}/check")
async def check_lab(lab_id: str):
    _ensure_seeded()
    now = _now()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.labs WHERE id = %s", (lab_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="lab not found")
        lab = _lab_dict(row)
        results = _mock_run_deterministic_checks(lab)
        all_passed = bool(results) and all(r["passed"] for r in results)
        for r in results:
            cur.execute(
                f"INSERT INTO {SCHEMA}.lab_checks (id, lab_id, check_name, passed, output, created_at) VALUES (%s, %s, %s, %s, %s, %s)",
                (str(uuid.uuid4()), lab_id, r["name"], int(r["passed"]), r["output"], now),
            )
        new_status = "passed" if all_passed else "failed"
        cur.execute(
            f"UPDATE {SCHEMA}.labs SET status = %s, terminal_output = %s, updated_at = %s WHERE id = %s",
            (new_status, "\n".join(f"$ check {r['name']}\n{r['output']}" for r in results), now, lab_id),
        )
        conn.commit()
        cur.execute(f"SELECT * FROM {SCHEMA}.labs WHERE id = %s", (lab_id,))
        row = cur.fetchone()
        cur.execute(
            f"SELECT * FROM {SCHEMA}.lab_checks WHERE lab_id = %s ORDER BY created_at ASC", (lab_id,)
        )
        checks = cur.fetchall()
    out = _lab_dict(row)
    out["checks"] = [dict(c) for c in checks]
    return out


@router.post("/labs/{lab_id}/reset")
async def reset_lab(lab_id: str):
    """Reset clears in-flight sandbox state only - prior lab_checks rows (the
    evidence trail) are preserved, never deleted, per contract."""
    _ensure_seeded()
    now = _now()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.labs WHERE id = %s", (lab_id,))
        row = cur.fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail="lab not found")
        cur.execute(
            f"UPDATE {SCHEMA}.labs SET status = 'not_started', terminal_output = %s, updated_at = %s WHERE id = %s",
            (row["terminal_output"], now, lab_id),  # terminal preserved for audit; status alone resets
        )
        conn.commit()
        cur.execute(f"SELECT * FROM {SCHEMA}.labs WHERE id = %s", (lab_id,))
        row = cur.fetchone()
    return _lab_dict(row)


class AssessmentSubmitBody(BaseModel):
    attempt_id: str = Field(..., description="Client-generated idempotency key")
    outcome: str
    help_used: Optional[str] = None
    notes: Optional[str] = None


_VALID_OUTCOMES = {
    "correct",
    "partial",
    "incorrect",
    "correct_with_hint",
    "correct_after_worked_example",
    "misconception",
    "prerequisite_gap",
    "transfer_success",
    "delayed_failure",
}


@router.get("/assessments/{assessment_id}/history")
async def assessment_history(assessment_id: str):
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT id FROM {SCHEMA}.assessments WHERE id = %s", (assessment_id,))
        if cur.fetchone() is None:
            raise HTTPException(status_code=404, detail="assessment not found")
        cur.execute(
            f"SELECT * FROM {SCHEMA}.attempts WHERE assessment_id = %s ORDER BY created_at ASC",
            (assessment_id,),
        )
        attempts = [dict(row) for row in cur.fetchall()]
    return {"assessment_id": assessment_id, "attempts": attempts, "total": len(attempts)}


@router.post("/assessments/{assessment_id}/submit")
async def submit_assessment(assessment_id: str, body: AssessmentSubmitBody):
    if body.outcome not in _VALID_OUTCOMES:
        raise HTTPException(status_code=422, detail=f"invalid outcome: {body.outcome}")
    _ensure_seeded()
    now = _now()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.assessments WHERE id = %s", (assessment_id,))
        assessment = cur.fetchone()
        if assessment is None:
            raise HTTPException(status_code=404, detail="assessment not found")

        cur.execute(
            f"SELECT * FROM {SCHEMA}.attempts WHERE assessment_id = %s AND attempt_id = %s",
            (assessment_id, body.attempt_id),
        )
        existing = cur.fetchone()
        if existing is not None:
            # Idempotent replay: return current state, do not double-count.
            cur.execute(f"SELECT * FROM {SCHEMA}.assessments WHERE id = %s", (assessment_id,))
            row = cur.fetchone()
            return {"assessment": _assessment_dict(row), "attempt": dict(existing), "idempotent_replay": True}

        cur.execute(
            f"INSERT INTO {SCHEMA}.attempts (id, assessment_id, attempt_id, outcome, help_used, notes, created_at) "
            "VALUES (%s, %s, %s, %s, %s, %s, %s)",
            (str(uuid.uuid4()), assessment_id, body.attempt_id, body.outcome, body.help_used, body.notes, now),
        )
        # A single hint/worked-example never equals "no help" or "independent
        # success" - evidence_count only increases on non-hinted correctness.
        bump = 1 if body.outcome in ("correct", "transfer_success") else 0
        cur.execute(
            f"UPDATE {SCHEMA}.assessments SET status = 'corrected', evidence_count = evidence_count + %s, "
            "help_used = COALESCE(%s, help_used), updated_at = %s WHERE id = %s",
            (bump, body.help_used, now, assessment_id),
        )
        conn.commit()
        cur.execute(f"SELECT * FROM {SCHEMA}.assessments WHERE id = %s", (assessment_id,))
        row = cur.fetchone()
        cur.execute(
            f"SELECT * FROM {SCHEMA}.attempts WHERE assessment_id = %s AND attempt_id = %s",
            (assessment_id, body.attempt_id),
        )
        attempt = cur.fetchone()
    return {"assessment": _assessment_dict(row), "attempt": dict(attempt), "idempotent_replay": False}
