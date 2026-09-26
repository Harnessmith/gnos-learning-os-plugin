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
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator, Optional

import psycopg
from psycopg.rows import dict_row
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

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
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- Append-only. A reschedule/repair NEVER updates an existing row; it only
-- inserts a new one. `source` distinguishes the two chronologies.
CREATE TABLE IF NOT EXISTS {SCHEMA}.timeline_entries (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES {SCHEMA}.sessions(id) ON DELETE SET NULL,
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

CREATE TABLE IF NOT EXISTS {SCHEMA}.resources (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    detail TEXT,
    url TEXT,
    provenance TEXT DEFAULT 'course-authored',
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS {SCHEMA}.projects (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    competencies TEXT,
    status TEXT NOT NULL DEFAULT 'planned',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
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

CREATE INDEX IF NOT EXISTS idx_timeline_session ON {SCHEMA}.timeline_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_timeline_source ON {SCHEMA}.timeline_entries(source);
CREATE INDEX IF NOT EXISTS idx_attempts_assessment ON {SCHEMA}.attempts(assessment_id);
CREATE INDEX IF NOT EXISTS idx_lab_checks_lab ON {SCHEMA}.lab_checks(lab_id);
"""


def _ensure_schema() -> None:
    with _connect() as conn:
        with conn.cursor() as cur:
            cur.execute(_SCHEMA_DDL)
        conn.commit()


# --------------------------------------------------------------------------
# Seed - deterministic DevOps journey fixture, matching the V1 mock content,
# now backed by real rows instead of a renderer-side literal. Only runs once
# (checked via a marker row) so it never clobbers real learner progress.
# --------------------------------------------------------------------------

def _seed_if_empty(conn: psycopg.Connection) -> None:
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
    _ensure_schema()
    with _connect() as conn:
        _seed_if_empty(conn)


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


# --------------------------------------------------------------------------
# GET routes
# --------------------------------------------------------------------------

@router.get("/health")
async def health():
    _ensure_seeded()
    return {"ok": True}


@router.get("/today")
async def get_today():
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT * FROM {SCHEMA}.sessions WHERE status = 'in_progress' ORDER BY updated_at DESC LIMIT 1"
        )
        session = cur.fetchone()
        if session is None:
            cur.execute(f"SELECT * FROM {SCHEMA}.sessions ORDER BY planned_date DESC LIMIT 1")
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
        "next": s.get("next_step"),
        "status": s.get("status"),
    }


@router.get("/tracks")
async def list_tracks():
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.tracks ORDER BY created_at ASC")
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
            f"SELECT * FROM {SCHEMA}.timeline_entries WHERE source = 'planned' ORDER BY created_at ASC"
        )
        planned = cur.fetchall()
        cur.execute(
            f"SELECT * FROM {SCHEMA}.timeline_entries WHERE source = 'actual' ORDER BY created_at ASC"
        )
        actual = cur.fetchall()
    return {"planned": [dict(r) for r in planned], "actual": [dict(r) for r in actual]}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.sessions WHERE id = %s", (session_id,))
        row = cur.fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="session not found")
    return _session_dict(row)


@router.get("/assessments")
async def list_assessments():
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.assessments ORDER BY created_at ASC")
        rows = cur.fetchall()
    return {"assessments": [_assessment_dict(r) for r in rows]}


@router.get("/evidence")
async def list_evidence():
    """Also serves as the 'progress' tree the dashboard renders as a drill-down."""
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.evidence ORDER BY depth ASC, updated_at ASC")
        rows = cur.fetchall()
    return {"evidence": [_evidence_dict(r) for r in rows]}


@router.get("/resources")
async def list_resources():
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.resources ORDER BY created_at ASC")
        rows = cur.fetchall()
    return {"resources": [dict(r) for r in rows]}


@router.get("/projects")
async def list_projects():
    _ensure_seeded()
    with _connect() as conn, conn.cursor() as cur:
        cur.execute(f"SELECT * FROM {SCHEMA}.projects ORDER BY created_at ASC")
        rows = cur.fetchall()
    return {"projects": [dict(r) for r in rows]}


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
        actual_topic = body.actual_topic or row["actual_topic"] or row["planned_topic"]
        cur.execute(
            f"UPDATE {SCHEMA}.sessions SET status = 'completed', actual_date = %s, actual_topic = %s, "
            "actual_duration = COALESCE(%s, actual_duration), next_step = COALESCE(%s, next_step), "
            "completed_at = %s, updated_at = %s WHERE id = %s",
            (now[:10], actual_topic, body.actual_duration, body.next_step, now, now, session_id),
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
