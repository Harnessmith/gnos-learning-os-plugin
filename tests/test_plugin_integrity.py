"""Regression tests for source synchronization and orphan timeline entries."""
from __future__ import annotations

import asyncio
import importlib
import json
import re
import sys
import tempfile
import unittest
import uuid
from fastapi import HTTPException
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DASHBOARD_DIR = ROOT / "plugins" / "hermes-desktop" / "gnos-learning-os" / "dashboard"
sys.path.insert(0, str(DASHBOARD_DIR))
from services.recommendations import choose_next
import sync_evidence
plugin_api = importlib.import_module("plugin_api")


class PluginIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.original_conninfo = plugin_api._conninfo
        self.original_schema = plugin_api.SCHEMA
        self.original_ddl = plugin_api._SCHEMA_DDL
        self.schema = f"gnos_test_{uuid.uuid4().hex[:12]}"
        plugin_api._conninfo = lambda: self.original_conninfo().replace(
            f"search_path%3D{self.original_schema}", f"search_path%3D{self.schema}"
        )
        plugin_api.SCHEMA = self.schema
        plugin_api._SCHEMA_DDL = re.sub(
            rf"\b{self.original_schema}\b", self.schema, self.original_ddl
        )
        plugin_api._ensure_schema()
        now = plugin_api._now()
        with plugin_api._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {self.schema}.tracks "
                "(id, title, stage, status, detail, competencies_json, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, '[]', %s, %s)",
                ("track-domain-devops", "DevOps", "Junior -> Pleno", "practicing", "real", now, now),
            )
            cur.execute(
                f"INSERT INTO {self.schema}.sessions "
                "(id, track_id, kind, planned_topic, planned_date, status, created_at, updated_at) "
                "VALUES ('session-devops-active', 'track-domain-devops', 'lesson', 'Sessão ativa', %s, 'in_progress', %s, %s)",
                (now[:10], now, now),
            )
            cur.execute(
                f"INSERT INTO {self.schema}.timeline_entries "
                "(id, session_id, source, entry_date, kind, text, adaptive_reason, created_at) "
                "VALUES (%s, NULL, 'planned', %s, %s, %s, NULL, %s)",
                ("timeline-devops-orphan", now[:10], "lesson", "Estudo sincronizado", now),
            )
            conn.commit()

    def tearDown(self):
        with plugin_api._connect() as conn, conn.cursor() as cur:
            cur.execute(f"DROP SCHEMA IF EXISTS {self.schema} CASCADE")
            conn.commit()
        plugin_api._conninfo = self.original_conninfo
        plugin_api.SCHEMA = self.original_schema
        plugin_api._SCHEMA_DDL = self.original_ddl

    def test_domain_synced_track_is_listed(self):
        result = asyncio.run(plugin_api.list_tracks())
        self.assertIn("track-domain-devops", {track["id"] for track in result["tracks"]})

    def test_next_priority_helper_prefers_active_session(self):
        kind, reason, payload = choose_next({"id": "active"}, {"id": "repair"}, {"id": "planned"})
        self.assertEqual((kind, reason, payload["id"]), ("session", "sessão em andamento", "active"))

    def test_timeline_entry_without_session_is_visible(self):
        result = asyncio.run(plugin_api.get_timeline())
        entries = result["planned"] + result["actual"]
        self.assertIn("timeline-devops-orphan", {entry["id"] for entry in entries})

    def test_next_study_prioritizes_active_session(self):
        result = asyncio.run(plugin_api.get_next_study())
        self.assertEqual(result["kind"], "session")
        self.assertEqual(result["session"]["id"], "session-devops-active")

    def test_course_track_cannot_be_deleted(self):
        now = plugin_api._now()
        with plugin_api._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {self.schema}.tracks "
                "(id, title, stage, status, source_type, detail, competencies_json, created_at, updated_at) "
                "VALUES ('track-course-protected', 'Curso', 'base', 'unknown', 'course', 'x', '[]', %s, %s)",
                (now, now),
            )
            conn.commit()
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(plugin_api.delete_track("track-course-protected"))
        self.assertEqual(ctx.exception.status_code, 409)

    def test_planned_session_cannot_be_completed_directly(self):
        now = plugin_api._now()
        with plugin_api._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {self.schema}.sessions "
                "(id, track_id, kind, planned_topic, planned_date, status, created_at, updated_at) "
                "VALUES ('session-planned-only', 'track-domain-devops', 'lesson', 'Aula', %s, 'planned', %s, %s)",
                (now[:10], now, now),
            )
            conn.commit()
        with self.assertRaises(HTTPException) as ctx:
            asyncio.run(plugin_api.complete_session("session-planned-only", plugin_api.SessionCompleteBody()))
        self.assertEqual(ctx.exception.status_code, 409)

    def test_manual_track_can_be_created_updated_and_deleted(self):
        created = asyncio.run(plugin_api.create_track(plugin_api.TrackCreateBody(title="Trilha temporária")))
        track_id = created["track"]["id"]
        updated = asyncio.run(plugin_api.update_track(track_id, plugin_api.TrackUpdateBody(title="Trilha revisada")))
        self.assertEqual(updated["track"]["title"], "Trilha revisada")
        deleted = asyncio.run(plugin_api.delete_track(track_id))
        self.assertEqual(deleted["deleted"], track_id)
        with plugin_api._connect() as conn, conn.cursor() as cur:
            cur.execute(f"SELECT id FROM {self.schema}.tracks WHERE id = %s", (track_id,))
            self.assertIsNone(cur.fetchone())

    def test_session_start_then_complete_is_idempotent(self):
        now = plugin_api._now()
        with plugin_api._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {self.schema}.sessions "
                "(id, track_id, kind, planned_topic, planned_date, status, created_at, updated_at) "
                "VALUES ('session-lifecycle', 'track-domain-devops', 'lesson', 'Ciclo', %s, 'planned', %s, %s)",
                (now[:10], now, now),
            )
            conn.commit()
        started = asyncio.run(plugin_api.start_session("session-lifecycle"))
        self.assertEqual(started["status"], "in_progress")
        completed = asyncio.run(plugin_api.complete_session("session-lifecycle", plugin_api.SessionCompleteBody(actual_duration=25)))
        repeated = asyncio.run(plugin_api.complete_session("session-lifecycle", plugin_api.SessionCompleteBody(actual_duration=99)))
        self.assertEqual(completed["status"], "completed")
        self.assertEqual(repeated["actual_duration"], 25)
        with plugin_api._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"SELECT COUNT(*) AS count FROM {self.schema}.timeline_entries WHERE session_id = %s AND source = 'actual'",
                ("session-lifecycle",),
            )
            self.assertEqual(cur.fetchone()["count"], 2)

    def test_library_supports_folders_search_kind_and_pagination(self):
        now = plugin_api._now()
        with plugin_api._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {self.schema}.courses "
                "(id, title, sources_json, created_at, updated_at) VALUES (%s, %s, %s, %s, %s)",
                (
                    "course-library",
                    "Biblioteca de testes",
                    json.dumps({
                        "docker": {"title": "Docker Docs", "url": "https://docs.docker.com"},
                        "python": {"title": "Python Docs", "url": "https://docs.python.org"},
                    }),
                    now,
                    now,
                ),
            )
            cur.execute(
                f"INSERT INTO {self.schema}.resources (id, type, title, detail, url, created_at) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                ("resource-library", "article", "Guia de revisão", "Docker e containers", "https://example.test", now),
            )
            conn.commit()
        page = asyncio.run(plugin_api.list_library(page=1, page_size=1, folder_id="sources:course-library"))
        self.assertEqual(page["total"], 2)
        self.assertEqual(len(page["items"]), 1)
        self.assertTrue(page["has_more"])
        searched = asyncio.run(plugin_api.list_library(q="Docker", kind="source"))
        self.assertEqual(searched["total"], 1)
        self.assertEqual(searched["items"][0]["title"], "Docker Docs")
        resources = asyncio.run(plugin_api.list_library(folder_id="resources:general", kind="resource"))
        self.assertEqual(resources["total"], 1)
        self.assertEqual(resources["items"][0]["id"], "resource-library")

    def test_session_notes_are_persisted_and_listed(self):
        note = asyncio.run(plugin_api.create_session_note("session-devops-active", plugin_api.SessionNoteBody(text="Revisar DNS")))
        self.assertEqual(note["note"]["text"], "Revisar DNS")
        result = asyncio.run(plugin_api.list_session_notes("session-devops-active"))
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["notes"][0]["text"], "Revisar DNS")

    def test_review_queue_prioritizes_repair_needed(self):
        now = plugin_api._now()
        with plugin_api._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {self.schema}.evidence "
                "(id, competency_id, label, status, attempts, misconceptions_json, updated_at) "
                "VALUES ('evidence-review', 'course:devops:dns', 'DNS', 'repair-needed', 2, '[]', %s)",
                (now,),
            )
            conn.commit()
        result = asyncio.run(plugin_api.get_review_queue())
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["items"][0]["status"], "repair-needed")

    def test_evidence_history_returns_status_changes(self):
        now = plugin_api._now()
        with plugin_api._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {self.schema}.evidence_history "
                "(id, competency_id, label, status, attempts, detail, recorded_at) "
                "VALUES ('history-1', 'course:devops:dns', 'DNS', 'exposed', 1, 'primeiro contato', %s)",
                (now,),
            )
            conn.commit()
        result = asyncio.run(plugin_api.get_evidence_history("course:devops:dns"))
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["history"][0]["status"], "exposed")
    def test_schedule_sync_is_idempotent_for_track_and_timeline(self):
        with tempfile.TemporaryDirectory() as raw_root:
            root = Path(raw_root)
            schedule_dir = root / "learners" / "joao" / "schedule"
            domain_dir = root / "domains" / "containers"
            schedule_dir.mkdir(parents=True)
            domain_dir.mkdir(parents=True)
            (domain_dir / "domain.json").write_text(
                json.dumps({"title": "Containers", "stage_from": "Base", "stage_to": "Intermediário"}),
                encoding="utf-8",
            )
            schedule_path = schedule_dir / "containers.json"
            schedule_path.write_text(
                json.dumps({
                    "planned": [
                        {"id": "plan-1", "entry_date": "2026-09-28", "kind": "lesson", "objective": "Dockerfile", "competency_ids": ["dockerfile"]},
                        {"id": "plan-2", "entry_date": "2026-09-29", "kind": "checkpoint", "objective": "Checkpoint", "competency_ids": ["dockerfile"]},
                    ],
                    "actual": [{"id": "actual-1", "entry_date": "2026-09-27", "kind": "lesson", "text": "Docker concluído"}],
                }),
                encoding="utf-8",
            )
            first = sync_evidence.sync_track_and_timeline(root, "joao", "containers")
            second = sync_evidence.sync_track_and_timeline(root, "joao", "containers")
            self.assertEqual(first["track_id"], "track-domain-containers")
            self.assertEqual(second["planned_synced"], ["plan-1", "plan-2"])
            with plugin_api._connect() as conn, conn.cursor() as cur:
                cur.execute(f"SELECT COUNT(*) AS count FROM {self.schema}.tracks WHERE id = %s", ("track-domain-containers",))
                self.assertEqual(cur.fetchone()["count"], 1)
                cur.execute(f"SELECT COUNT(*) AS count FROM {self.schema}.timeline_entries WHERE id IN ('plan-1', 'plan-2', 'actual-1')")
                self.assertEqual(cur.fetchone()["count"], 3)
            schedule_path.write_text(
                json.dumps({
                    "planned": [{"id": "plan-1", "entry_date": "2026-09-30", "kind": "lesson", "objective": "Dockerfile revisado", "competency_ids": ["dockerfile"]}],
                    "actual": [{"id": "actual-1", "entry_date": "2026-09-27", "kind": "lesson", "text": "Docker concluído"}],
                }),
                encoding="utf-8",
            )
            sync_evidence.sync_track_and_timeline(root, "joao", "containers")
            with plugin_api._connect() as conn, conn.cursor() as cur:
                cur.execute(f"SELECT entry_date, text FROM {self.schema}.timeline_entries WHERE id = %s", ("plan-1",))
                row = cur.fetchone()
                self.assertEqual((row["entry_date"], row["text"]), ("2026-09-30", "Dockerfile revisado"))
                cur.execute(f"SELECT track_id FROM {self.schema}.timeline_entries WHERE id = %s", ("plan-1",))
                self.assertEqual(cur.fetchone()["track_id"], "track-domain-containers")
                cur.execute(f"SELECT COUNT(*) AS count FROM {self.schema}.timeline_entries WHERE id = %s", ("plan-1",))
                self.assertEqual(cur.fetchone()["count"], 1)

    def test_evidence_sync_is_idempotent_and_records_only_changes(self):
        with tempfile.TemporaryDirectory() as raw_root:
            root = Path(raw_root)
            evidence_dir = root / "learners" / "joao" / "evidence"
            domain_dir = root / "domains" / "devops"
            evidence_dir.mkdir(parents=True)
            domain_dir.mkdir(parents=True)
            (domain_dir / "domain.json").write_text(
                json.dumps({"competencies": [{"id": "dns", "title": "DNS"}]}),
                encoding="utf-8",
            )
            evidence_path = evidence_dir / "devops.json"
            evidence_path.write_text(
                json.dumps({"competencies": {"dns": {
                    "status": "practicing",
                    "attempts": 2,
                    "last_reason": "Praticou resolução de nomes",
                    "next_intervention": "Lab guiado",
                    "last_evidence_at": "2026-09-27T10:00:00+00:00",
                }}}),
                encoding="utf-8",
            )
            first = sync_evidence.sync_learner_domain(root, "joao", "devops")
            second = sync_evidence.sync_learner_domain(root, "joao", "devops")
            self.assertEqual(first["inserted"], ["dns"])
            self.assertEqual(second["updated"], ["dns"])
            with plugin_api._connect() as conn, conn.cursor() as cur:
                cur.execute(f"SELECT COUNT(*) AS count FROM {self.schema}.evidence_history WHERE competency_id = %s", ("dns",))
                self.assertEqual(cur.fetchone()["count"], 1)
            evidence_path.write_text(
                json.dumps({"competencies": {"dns": {
                    "status": "demonstrated",
                    "attempts": 3,
                    "last_reason": "Demonstrou em exercício",
                    "next_intervention": None,
                    "last_evidence_at": "2026-09-27T11:00:00+00:00",
                }}}),
                encoding="utf-8",
            )
            sync_evidence.sync_learner_domain(root, "joao", "devops")
            with plugin_api._connect() as conn, conn.cursor() as cur:
                cur.execute(f"SELECT status FROM {self.schema}.evidence WHERE competency_id = %s", ("dns",))
                self.assertEqual(cur.fetchone()["status"], "demonstrated")
                cur.execute(f"SELECT COUNT(*) AS count FROM {self.schema}.evidence_history WHERE competency_id = %s", ("dns",))
                self.assertEqual(cur.fetchone()["count"], 2)

if __name__ == "__main__":
    unittest.main()
