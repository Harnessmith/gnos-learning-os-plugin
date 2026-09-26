"""Phase 4: profile -> plugin evidence sync.

The Didaktos PROFILE (chat-driven teaching) writes ground-truth evidence to
`learners/<learner>/evidence/<domain-id>.json` via
`skills/review-engine/scripts/write_evidence.py`. The PLUGIN (desktop
dashboard) reads evidence from its own Postgres schema (`gnos_learning_os`),
seeded so far only with a deterministic fixture. This module is the missing
link: it reads the profile's evidence file and upserts it into the plugin's
`evidence` table, so a real teaching session shows up on the Progresso page.

This is a ONE-WAY sync (profile -> plugin) run explicitly, not a live
subscription: call `sync_learner_domain()` after a teaching session, or wire
it to a cron/watch loop later. It does not touch tracks/sessions/timeline —
those still come from the plugin's own seed fixture; only competency
evidence is bridged in this phase (see module docstring in plugin_api.py for
what remains fixture-backed).
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import plugin_api


def _load_domain_titles(workspace_root: Path, domain_id: str) -> dict[str, str]:
    """competency_id -> title, read from the profile's domain.json. Falls
    back to the raw id if the domain file is missing or a competency isn't
    declared in it (evidence should still sync even if the domain moved)."""
    domain_path = workspace_root / "domains" / domain_id / "domain.json"
    if not domain_path.exists():
        return {}
    domain = json.loads(domain_path.read_text(encoding="utf-8"))
    return {c["id"]: c.get("title", c["id"]) for c in domain.get("competencies", [])}


def _load_evidence_file(workspace_root: Path, learner: str, domain_id: str) -> dict:
    if not re.fullmatch(r"[a-z0-9]+(?:[-_][a-z0-9]+)*", learner):
        raise ValueError(f"invalid learner slug: {learner!r}")
    path = workspace_root / "learners" / learner / "evidence" / f"{domain_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"no evidence file at {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def sync_learner_domain(workspace_root: Path, learner: str, domain_id: str) -> dict[str, Any]:
    """Upsert every competency in the profile's evidence file into the
    plugin's `evidence` table. Returns a summary: how many rows were
    inserted vs. updated, and which competency ids were touched.
    """
    evidence = _load_evidence_file(workspace_root, learner, domain_id)
    titles = _load_domain_titles(workspace_root, domain_id)

    competencies: dict[str, dict] = evidence.get("competencies", {})
    inserted, updated, touched = [], [], []

    plugin_api._ensure_schema()
    with plugin_api._connect() as conn:
        with conn.cursor() as cur:
            for competency_id, entry in competencies.items():
                label = titles.get(competency_id, competency_id)
                misconceptions = [entry["misconception_id"]] if entry.get("misconception_id") else []
                cur.execute(
                    f"SELECT 1 FROM {plugin_api.SCHEMA}.evidence WHERE competency_id = %s",
                    (competency_id,),
                )
                exists = cur.fetchone() is not None
                cur.execute(
                    f"""
                    INSERT INTO {plugin_api.SCHEMA}.evidence
                        (id, competency_id, label, status, attempts, detail,
                         misconceptions_json, next_intervention, depth, updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (competency_id) DO UPDATE SET
                        label = EXCLUDED.label,
                        status = EXCLUDED.status,
                        attempts = EXCLUDED.attempts,
                        detail = EXCLUDED.detail,
                        misconceptions_json = EXCLUDED.misconceptions_json,
                        next_intervention = EXCLUDED.next_intervention,
                        updated_at = EXCLUDED.updated_at
                    """,
                    (
                        competency_id, competency_id, label, entry.get("status", "unknown"),
                        entry.get("attempts", 0), entry.get("last_reason"),
                        json.dumps(misconceptions), entry.get("next_intervention"),
                        0, entry.get("last_evidence_at") or plugin_api._now(),
                    ),
                )
                (updated if exists else inserted).append(competency_id)
                touched.append(competency_id)
        conn.commit()

    return {
        "learner": learner,
        "domain_id": domain_id,
        "inserted": inserted,
        "updated": updated,
        "touched": touched,
    }


def _load_schedule_file(workspace_root: Path, learner: str, domain_id: str) -> dict:
    if not re.fullmatch(r"[a-z0-9]+(?:[-_][a-z0-9]+)*", learner):
        raise ValueError(f"invalid learner slug: {learner!r}")
    path = workspace_root / "learners" / learner / "schedule" / f"{domain_id}.json"
    if not path.exists():
        raise FileNotFoundError(f"no schedule file at {path}")
    return json.loads(path.read_text(encoding="utf-8"))


def _load_domain_meta(workspace_root: Path, domain_id: str) -> dict:
    domain_path = workspace_root / "domains" / domain_id / "domain.json"
    if not domain_path.exists():
        return {"title": domain_id, "stage_from": "", "stage_to": ""}
    domain = json.loads(domain_path.read_text(encoding="utf-8"))
    return {
        "title": domain.get("title", domain_id),
        "stage_from": domain.get("stage_from", ""),
        "stage_to": domain.get("stage_to", ""),
    }


def sync_track_and_timeline(workspace_root: Path, learner: str, domain_id: str) -> dict[str, Any]:
    """Upsert the profile's real-dated schedule (build_schedule.py /
    reschedule.py output, `learners/<learner>/schedule/<domain-id>.json`)
    into the plugin's `tracks` and `timeline_entries` tables.

    Idempotent by construction: every schedule entry already carries its own
    stable `id` (a uuid assigned once by build_schedule.py/reschedule.py), so
    re-running this after a reschedule only ever upserts by that id — it
    never duplicates a planned/actual row.

    Scope of this sync: track identity + the planned/actual timeline only.
    It does NOT synthesize full `sessions` rows (objectives/activities/
    blocks) from a schedule alone — see `sync_lesson_session()` below for
    the counterpart that syncs a real published lesson (with real blocks)
    as a session.
    """
    schedule = _load_schedule_file(workspace_root, learner, domain_id)
    meta = _load_domain_meta(workspace_root, domain_id)

    track_id = f"track-{domain_id}"
    planned = schedule.get("planned", [])
    actual = schedule.get("actual", [])
    competency_ids: list[str] = []
    for entry in planned:
        for cid in entry.get("competency_ids", []):
            if cid not in competency_ids:
                competency_ids.append(cid)

    stage = f"{meta['stage_from']} -> {meta['stage_to']}" if meta["stage_from"] else meta["stage_to"]
    status = "practicing" if actual else ("exposed" if planned else "unknown")
    last_entry = (actual[-1] if actual else (planned[-1] if planned else None))
    detail = last_entry.get("text") or last_entry.get("objective") if last_entry else None

    plugin_api._ensure_schema()
    planned_synced, actual_synced = [], []
    with plugin_api._connect() as conn:
        with conn.cursor() as cur:
            now = plugin_api._now()
            cur.execute(
                f"""
                INSERT INTO {plugin_api.SCHEMA}.tracks
                    (id, title, stage, status, detail, competencies_json, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title,
                    stage = EXCLUDED.stage,
                    status = EXCLUDED.status,
                    detail = EXCLUDED.detail,
                    competencies_json = EXCLUDED.competencies_json,
                    updated_at = EXCLUDED.updated_at
                """,
                (track_id, meta["title"], stage, status, detail,
                 json.dumps(competency_ids), now, now),
            )

            for entry in planned:
                cur.execute(
                    f"""
                    INSERT INTO {plugin_api.SCHEMA}.timeline_entries
                        (id, session_id, source, entry_date, kind, text, adaptive_reason, created_at)
                    VALUES (%s, NULL, 'planned', %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        entry_date = EXCLUDED.entry_date,
                        kind = EXCLUDED.kind,
                        text = EXCLUDED.text,
                        adaptive_reason = EXCLUDED.adaptive_reason
                    """,
                    (entry["id"], entry["entry_date"], entry["kind"],
                     entry.get("objective", ""), entry.get("adaptive_reason"), now),
                )
                planned_synced.append(entry["id"])

            for entry in actual:
                cur.execute(
                    f"""
                    INSERT INTO {plugin_api.SCHEMA}.timeline_entries
                        (id, session_id, source, entry_date, kind, text, adaptive_reason, created_at)
                    VALUES (%s, NULL, 'actual', %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO UPDATE SET
                        entry_date = EXCLUDED.entry_date,
                        kind = EXCLUDED.kind,
                        text = EXCLUDED.text,
                        adaptive_reason = EXCLUDED.adaptive_reason
                    """,
                    (entry["id"], entry["entry_date"], entry["kind"],
                     entry.get("text", ""), entry.get("adaptive_reason"), now),
                )
                actual_synced.append(entry["id"])
        conn.commit()

    return {
        "learner": learner,
        "domain_id": domain_id,
        "track_id": track_id,
        "planned_synced": planned_synced,
        "actual_synced": actual_synced,
    }


_BLOCK_LABELS = {
    "explanation": "Texto", "bullets": "Texto", "equation": "Equação",
    "code": "Código", "source": "Fonte", "diagram": "Diagrama",
    "artifact": "Diagrama", "voice-animation": "Vídeo", "animation": "Vídeo",
    "interactive-graph": "Simulação", "simulation": "Simulação",
    "exercise": "Exercício", "feedback": "Feedback",
}


def _lesson_block_to_pair(block: dict, exercises_by_id: dict[str, dict]) -> list[str]:
    """Turn one validated public lesson block into the [label, body] pair the
    Aula (lesson-detail) page renders. Media blocks (video/diagram/simulation)
    carry only their caption/purpose here — the plugin renders their real
    artifact through the course-viewer portal, not inline in this table."""
    block_type = block.get("type", "explanation")
    label = _BLOCK_LABELS.get(block_type, "Texto")
    if block_type == "bullets":
        body = "\n".join(f"- {item}" for item in block.get("items", []))
    elif block_type == "equation":
        body = block.get("equation", "")
    elif block_type == "code":
        body = block.get("code", "")
    elif block_type == "source":
        body = block.get("caption") or block.get("label") or f"Fonte: {block.get('source_id', '')}"
    elif block_type == "exercise":
        exercise_id = block.get("exercise_id") or ""
        exercise = exercises_by_id.get(exercise_id, {})
        prompt = exercise.get("prompt", block.get("purpose", ""))
        options = exercise.get("evaluation", {}).get("options")
        body = prompt if not options else f"{prompt}\n" + "\n".join(f"- {o}" for o in options)
    elif block_type in ("diagram", "artifact", "voice-animation", "animation",
                        "interactive-graph", "simulation"):
        body = block.get("caption") or block.get("label") or block.get("purpose", "")
    else:
        body = block.get("text") or block.get("purpose", "")
    return [label, body]


def _load_course_and_lesson(workspace_root: Path, learner: str, course_id: str,
                             lesson_id: str) -> tuple[dict, dict]:
    if not re.fullmatch(r"[a-z0-9]+(?:[-_][a-z0-9]+)*", learner):
        raise ValueError(f"invalid learner slug: {learner!r}")
    base = workspace_root / "learners" / learner / "courses" / course_id
    course_path = base / "course.json"
    lesson_path = base / "lessons" / lesson_id / "lesson.json"
    if not course_path.exists():
        raise FileNotFoundError(f"no course file at {course_path}")
    if not lesson_path.exists():
        raise FileNotFoundError(f"no lesson file at {lesson_path}")
    course = json.loads(course_path.read_text(encoding="utf-8"))
    lesson = json.loads(lesson_path.read_text(encoding="utf-8"))
    return course, lesson


def sync_lesson_session(workspace_root: Path, learner: str, course_id: str,
                         lesson_id: str) -> dict[str, Any]:
    """Sync one published, `ready` lesson (a real Didaktos teaching session,
    built by skills/lesson-design/SKILL.md and stored at
    learners/<learner>/courses/<course-id>/lessons/<lesson-id>/lesson.json)
    into the plugin's `sessions` + `tracks` + `timeline_entries` tables, so
    the Aula and Hoje pages show real teaching content instead of the seed
    fixture.

    Refuses lessons that are not `publication: ready` — a draft has not
    passed the lesson-design review checklist yet and must not appear as a
    finished session on the dashboard.
    """
    course, lesson = _load_course_and_lesson(workspace_root, learner, course_id, lesson_id)
    if lesson.get("publication") != "ready":
        raise ValueError(
            f"lesson {lesson_id!r} is {lesson.get('publication')!r}, not 'ready'; "
            "only a published, reviewed lesson can sync as a session")

    exercises_by_id = {e["id"]: e for e in lesson.get("exercises", [])}
    blocks = [_lesson_block_to_pair(b, exercises_by_id) for b in lesson.get("blocks", [])]
    teacher = lesson.get("teacher") or "Didaktos"
    updated_date = lesson["updated_at"][:10]
    track_id = f"track-course-{course_id}"
    session_id = f"session-{course_id}-{lesson_id}"
    next_step = (course.get("current") or {}).get("next_step")

    plugin_api._ensure_schema()
    with plugin_api._connect() as conn:
        with conn.cursor() as cur:
            now = plugin_api._now()
            cur.execute(
                f"""
                INSERT INTO {plugin_api.SCHEMA}.tracks
                    (id, title, stage, status, detail, competencies_json, created_at, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    title = EXCLUDED.title, stage = EXCLUDED.stage,
                    status = EXCLUDED.status, detail = EXCLUDED.detail,
                    updated_at = EXCLUDED.updated_at
                """,
                (track_id, course.get("title", course_id), course.get("depth", "working"),
                 "practicing", lesson["title"], json.dumps(lesson.get("concepts", [])), now, now),
            )
            cur.execute(
                f"""
                INSERT INTO {plugin_api.SCHEMA}.sessions
                    (id, track_id, kind, planned_topic, actual_topic, planned_date, actual_date,
                     planned_duration, actual_duration, objectives_json, activities_json,
                     objective, teacher, blocks_json, status, started_at, completed_at,
                     next_step, created_at, updated_at)
                VALUES (%s, %s, 'lesson', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                        'in_progress', %s, NULL, %s, %s, %s)
                ON CONFLICT (id) DO UPDATE SET
                    actual_topic = EXCLUDED.actual_topic, actual_date = EXCLUDED.actual_date,
                    objective = EXCLUDED.objective, teacher = EXCLUDED.teacher,
                    blocks_json = EXCLUDED.blocks_json, next_step = EXCLUDED.next_step,
                    updated_at = EXCLUDED.updated_at
                """,
                (session_id, track_id, lesson["title"], lesson["title"],
                 updated_date, updated_date, None, None,
                 json.dumps([lesson["purpose"]]),
                 json.dumps(["leitura", "exercicio"] if exercises_by_id else ["leitura"]),
                 lesson["purpose"], teacher, json.dumps(blocks),
                 now, next_step, now, now),
            )
            entry_id = f"timeline-{session_id}"
            cur.execute(
                f"""
                INSERT INTO {plugin_api.SCHEMA}.timeline_entries
                    (id, session_id, source, entry_date, kind, text, adaptive_reason, created_at)
                VALUES (%s, %s, 'actual', %s, 'lesson', %s, NULL, %s)
                ON CONFLICT (id) DO UPDATE SET
                    entry_date = EXCLUDED.entry_date, text = EXCLUDED.text
                """,
                (entry_id, session_id, updated_date, lesson["title"], now),
            )
        conn.commit()

    return {"learner": learner, "course_id": course_id, "lesson_id": lesson_id,
            "session_id": session_id, "track_id": track_id, "blocks_synced": len(blocks)}


def sync_all(workspace_root: Path, learner: str, domain_id: str) -> dict[str, Any]:
    """Run every available sync for one learner/domain pair. Each half is
    independent and best-effort: a missing evidence or schedule file (the
    learner hasn't been assessed / scheduled yet for this domain) is
    reported, not raised, so one missing file doesn't block the other half.
    """
    result: dict[str, Any] = {"learner": learner, "domain_id": domain_id}
    try:
        result["evidence"] = sync_learner_domain(workspace_root, learner, domain_id)
    except FileNotFoundError as exc:
        result["evidence"] = {"skipped": str(exc)}
    try:
        result["timeline"] = sync_track_and_timeline(workspace_root, learner, domain_id)
    except FileNotFoundError as exc:
        result["timeline"] = {"skipped": str(exc)}
    return result


def main() -> int:
    import argparse
    import sys

    ap = argparse.ArgumentParser()
    ap.add_argument("--workspace-root", type=Path, required=True,
                     help="path to the didaktos profile workspace, e.g. "
                          "~/.hermes/profiles/didaktos/workspace")
    ap.add_argument("--learner", required=True)
    ap.add_argument("--domain-id")
    ap.add_argument("--course-id")
    ap.add_argument("--lesson-id")
    ap.add_argument("--what", choices=["evidence", "timeline", "session", "all"], default="all")
    args = ap.parse_args()

    try:
        if args.what == "evidence":
            summary = sync_learner_domain(args.workspace_root, args.learner, args.domain_id)
        elif args.what == "timeline":
            summary = sync_track_and_timeline(args.workspace_root, args.learner, args.domain_id)
        elif args.what == "session":
            if not (args.course_id and args.lesson_id):
                print(json.dumps({"error": "--what session requires --course-id and --lesson-id"}),
                      file=sys.stderr)
                return 1
            summary = sync_lesson_session(args.workspace_root, args.learner, args.course_id, args.lesson_id)
        else:
            summary = sync_all(args.workspace_root, args.learner, args.domain_id)
    except (FileNotFoundError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
