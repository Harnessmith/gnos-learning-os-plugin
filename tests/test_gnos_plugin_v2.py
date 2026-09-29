"""Contract tests for the GNOS Desktop plugin V2 (renderer + real backend).

V1 tested a renderer-only mock. V2 replaces the mock with a real
`dashboard/plugin_api.py` reached exclusively via `ctx.rest` — these tests
assert the renderer never re-introduces a direct data/shell escape hatch, and
that the backend implements the durable-history invariants (planned/actual
append-only, idempotent submissions, no destructive lab-check history loss).
"""

import asyncio
import importlib
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
PLUGIN_DIR = ROOT / "plugins" / "hermes-desktop" / "gnos-learning-os"
DESKTOP_JS = PLUGIN_DIR / "desktop" / "plugin.js"
DASHBOARD_DIR = PLUGIN_DIR / "dashboard"


class GnosDesktopPluginRendererTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = DESKTOP_JS.read_text(encoding="utf-8")

    def test_declares_all_nine_dashboard_routes(self):
        for route in (
            "today",
            "tracks",
            "timeline",
            "lesson",
            "lab",
            "assessments",
            "progress",
            "resources",
            "projects",
        ):
            self.assertIn(f"['{route}'", self.source)

    def test_uses_supported_sdk_extension_points(self):
        self.assertIn("@hermes/plugin-sdk", self.source)
        for contribution in ("ROUTES_AREA", "SIDEBAR_NAV_AREA", "PALETTE_AREA"):
            self.assertIn(contribution, self.source)

    def test_uses_one_global_sidebar_entry_and_internal_navigation(self):
        self.assertIn("id: 'gnos.nav.root'", self.source)
        self.assertNotIn("id: `gnos.nav.${path}`", self.source)
        self.assertIn("function GnosShell", self.source)
        self.assertIn("aria-label': 'Navegação do GNOS Learning OS'", self.source)

    def test_reads_exclusively_through_the_plugin_backend(self):
        # No renderer-side mock literal, no direct filesystem/shell escape.
        self.assertNotIn("const mockGateway", self.source)
        self.assertNotIn("readFile", self.source)
        self.assertNotIn("child_process", self.source)
        self.assertNotIn("shell_exec", self.source)
        # Server-origin portals are forwarded through the Desktop SSH bridge.
        # This preserves an HTTP Referer for YouTube, while srcDoc remains the
        # safe fallback if bridge forwarding is unavailable.
        self.assertIn("window.hermesDesktop?.reachPreviewUrl", self.source)
        self.assertIn("server_portal_url", self.source)
        self.assertIn("srcDoc: reachablePortalUrl ? undefined : html", self.source)
        # Every application read/write must go through ctx.rest, bound once in activate().
        self.assertIn("ctx.rest(path, opts)", self.source)
        self.assertIn("function rest(path, opts)", self.source)

    def test_lesson_route_uses_module_scoped_rich_text(self):
        """The bundled route must not depend on a prop alias that can go stale."""
        self.assertIn("children: isCode ? jsx('pre'", self.source)
        self.assertIn("jsx(RichText, { text: body })", self.source)
        self.assertNotIn("SharedRichText", self.source)

    def test_internal_app_is_functional_not_a_static_shell(self):
        for marker in (
            "className: 'gnos-shell'",
            "className: 'gnos-profile'",
            "const responsiveCss",
            "function evidencePercent",
            "useState",
        ):
            self.assertIn(marker, self.source)
        for endpoint in (
            "/sessions/${data.session_id}/start",
            "/sessions/${sessionId}/complete",
            "useApi('/labs'",
            "/labs/${labId}/${kind}",
            "/assessments/${assessment.id}/submit",
        ):
            self.assertIn(endpoint, self.source)
        for forbidden in (
            "window.location.reload",
            "alert(",
            "React.useState",
            "const LAB_ID",
            "placeholder)",
        ):
            self.assertNotIn(forbidden, self.source)

    def test_preserves_the_supplied_standalone_visual_language(self):
        """Prevent regression to a sparse, host-theme-only shell."""
        for marker in (
            "--background:#090b0f",
            "--card:#11141a",
            "--accent:#7c5cff",
            "gridTemplateColumns: '248px minmax(0, 1fr)'",
            "borderRadius: 18",
            "title: 'Foco de hoje'",
            "width: 112, height: 112",
        ):
            self.assertIn(marker, self.source)
        self.assertNotIn("maxWidth: 1120", self.source)


class GnosPluginBackendTests(unittest.TestCase):
    """Headless functional tests against the real plugin_api.py module,
    isolated to a throwaway SQLite DB per test run (see setUp)."""

    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(DASHBOARD_DIR))
        import plugin_api  # noqa: E402

        cls.api = plugin_api

    def setUp(self):
        # Isolate every test in its own throwaway Postgres schema so tests
        # never see each other's rows or the dev schema's seeded fixture.
        import re
        import uuid as _uuid

        self._schema = f"gnos_test_{_uuid.uuid4().hex[:12]}"
        self._orig_conninfo = self.api._conninfo
        self._orig_schema_const = self.api.SCHEMA
        self._orig_ddl = self.api._SCHEMA_DDL

        self.api._conninfo = lambda: self._orig_conninfo().replace(
            f"search_path%3D{self._orig_schema_const}", f"search_path%3D{self._schema}"
        )
        self.api.SCHEMA = self._schema
        # _SCHEMA_DDL was rendered with the module-level SCHEMA constant at
        # import time, so rebuild it against the per-test schema name.
        self.api._SCHEMA_DDL = re.sub(
            rf"\b{self._orig_schema_const}\b", self._schema, self._orig_ddl
        )
        self._create_real_course_fixture()

    def tearDown(self):
        with self.api._connect() as conn, conn.cursor() as cur:
            cur.execute(f"DROP SCHEMA IF EXISTS {self._schema} CASCADE")
            conn.commit()
        self.api._conninfo = self._orig_conninfo
        self.api.SCHEMA = self._orig_schema_const
        self.api._SCHEMA_DDL = self._orig_ddl

    def _run(self, coro):
        return asyncio.run(coro)

    def _create_real_course_fixture(self):
        """Explicit course-origin data; routes must never auto-seed demos."""
        self.api._ensure_schema()
        now = self.api._now()
        with self.api._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {self.api.SCHEMA}.tracks "
                "(id, title, stage, status, detail, competencies_json, created_at, updated_at) "
                "VALUES ('track-course-test', 'Curso de teste', 'working', 'practicing', "
                "'Sessão real de teste', '[]', %s, %s)", (now, now),
            )
            cur.execute(
                f"INSERT INTO {self.api.SCHEMA}.sessions "
                "(id, track_id, kind, planned_topic, actual_topic, planned_date, actual_date, "
                "objectives_json, activities_json, objective, teacher, blocks_json, status, started_at, "
                "next_step, created_at, updated_at) VALUES "
                "('session-course-test', 'track-course-test', 'lesson', 'Sessão de teste', "
                "'Sessão de teste', '2026-09-26', '2026-09-26', '[]', '[]', 'Objetivo de teste', "
                "'Didaktos', '[]', 'in_progress', %s, 'Próximo passo', %s, %s)",
                (now, now, now),
            )
            cur.execute(
                f"INSERT INTO {self.api.SCHEMA}.timeline_entries "
                "(id, session_id, source, entry_date, kind, text, adaptive_reason, created_at) "
                "VALUES ('timeline-course-test', 'session-course-test', 'actual', '2026-09-26', "
                "'lesson', 'Sessão de teste', NULL, %s)", (now,),
            )
            cur.execute(
                f"INSERT INTO {self.api.SCHEMA}.labs "
                "(id, session_id, title, objective, environment_json, allowed_tools_json, task, "
                "expected_behavior, deterministic_checks_json, status, terminal_output, created_at, updated_at) "
                "VALUES ('lab-course-test', 'session-course-test', 'Lab de teste', 'Objetivo', "
                "'{}', '[]', 'Tarefa', 'Resultado', "
                "'[{\"name\": \"check\", \"expect\": \"pass\"}]', 'not_started', '', %s, %s)",
                (now, now),
            )
            cur.execute(
                f"INSERT INTO {self.api.SCHEMA}.assessments "
                "(id, session_id, title, type, status, result, help_used, evidence_count, created_at, updated_at) "
                "VALUES ('assessment-course-test', 'session-course-test', 'Avaliação de teste', "
                "'exercise', 'planned', NULL, '-', 0, %s, %s)", (now, now),
            )
            conn.commit()

    def test_today_reflects_a_course_origin_in_progress_session(self):
        today = self._run(self.api.get_today())
        self.assertEqual(today["status"], "in_progress")
        self.assertEqual("Sessão de teste", today["session"])

    def test_legacy_portal_path_is_translated_to_the_active_workspace(self):
        """Old database rows must survive the workspace-root migration."""
        original_workspace_root = self.api.WORKSPACE_ROOT
        with TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            workspace_root = tmp_path / "workspace"
            legacy_home = tmp_path / "legacy-home"
            portal = (
                workspace_root / "learners" / "airflow" / "courses" / "course" /
                "portal" / "index.html"
            )
            portal.parent.mkdir(parents=True)
            portal.write_text("<main>Conteúdo da aula</main>", encoding="utf-8")
            legacy_path = (
                legacy_home / "learners" / "airflow" / "courses" / "course" /
                "portal" / "index.html"
            )
            self.api.WORKSPACE_ROOT = workspace_root
            try:
                with patch.object(self.api.Path, "home", return_value=legacy_home):
                    html = self.api._read_portal_html(str(legacy_path))
            finally:
                self.api.WORKSPACE_ROOT = original_workspace_root
        self.assertIn("Conteúdo da aula", html)

    def test_session_portal_is_served_exclusively_by_the_ssh_backend(self):
        """Lesson HTML must cross the authenticated API, never a backend-local
        `127.0.0.1` URL that the SSH-connected Desktop cannot address."""
        with TemporaryDirectory() as tmp:
            portal = Path(tmp) / "portal" / "index.html"
            portal.parent.mkdir(parents=True)
            portal.write_text(
                "<iframe src='https://www.youtube-nocookie.com/embed/x'></iframe>",
                encoding="utf-8",
            )
            now = self.api._now()
            with self.api._connect() as conn, conn.cursor() as cur:
                cur.execute(
                    f"UPDATE {self.api.SCHEMA}.sessions SET portal_path = %s, "
                    "updated_at = %s WHERE id = 'session-course-test'",
                    (str(portal), now),
                )
                conn.commit()
            from unittest.mock import patch
            with patch.object(self.api, "_read_portal_html", return_value="<iframe src='https://www.youtube-nocookie.com/embed/x'></iframe>"):
                result = self._run(self.api.get_session_portal("session-course-test"))
            self.assertNotIn("portal_url", result)
            self.assertIn("html", result)
            self.assertIn("server_portal_url", result)
            self.assertTrue(result["server_portal_url"].startswith("http://127.0.0.1:"))

    def test_session_portal_falls_back_to_inline_html_without_a_portal_file(self):
        """When the loopback origin cannot be minted (e.g. material_server
        unavailable), the route must still answer with the legacy inline-html
        contract rather than error out."""
        with TemporaryDirectory() as tmp:
            original_workspace_root = self.api.WORKSPACE_ROOT
            workspace_root = Path(tmp) / "workspace"
            portal = (
                workspace_root / "learners" / "airflow" / "courses" / "course" /
                "portal" / "index.html"
            )
            portal.parent.mkdir(parents=True)
            portal.write_text("<main>Conteúdo da aula</main>", encoding="utf-8")
            self.api.WORKSPACE_ROOT = workspace_root
            now = self.api._now()
            try:
                with self.api._connect() as conn, conn.cursor() as cur:
                    cur.execute(
                        f"UPDATE {self.api.SCHEMA}.sessions SET portal_path = %s, "
                        "updated_at = %s WHERE id = 'session-course-test'",
                        (str(portal), now),
                    )
                    conn.commit()
                with patch.object(
                    self.api.material_server, "material_url",
                    side_effect=RuntimeError("material origin unavailable"),
                ):
                    result = self._run(self.api.get_session_portal("session-course-test"))
            finally:
                self.api.WORKSPACE_ROOT = original_workspace_root
        self.assertIn("html", result)
        self.assertNotIn("portal_url", result)
        self.assertIn("Conteúdo da aula", result["html"])

    def test_timeline_planned_is_never_mutated_by_session_actions(self):
        before = self._run(self.api.get_timeline())
        planned_before = before["planned"]
        self._run(self.api.start_session("session-course-test"))
        self._run(
            self.api.complete_session(
                "session-course-test",
                self.api.SessionCompleteBody(next_step="Novo próximo passo"),
            )
        )
        after = self._run(self.api.get_timeline())
        self.assertEqual(planned_before, after["planned"])
        self.assertGreater(len(after["actual"]), len(before["actual"]))

    def test_lab_lifecycle_start_check_reset_never_deletes_check_history(self):
        lab_id = "lab-course-test"
        labs = self._run(self.api.list_labs())["labs"]
        self.assertIn(lab_id, [lab["id"] for lab in labs])
        self._run(self.api.start_lab(lab_id))
        checked = self._run(self.api.check_lab(lab_id))
        self.assertEqual(checked["status"], "failed")  # no fabricated success
        self.assertTrue(checked["checks"])
        n_checks_before_reset = len(checked["checks"])
        reset = self._run(self.api.reset_lab(lab_id))
        self.assertEqual(reset["status"], "not_started")
        after_reset = self._run(self.api.get_lab(lab_id))
        self.assertEqual(len(after_reset["checks"]), n_checks_before_reset)

    def test_assessment_submission_is_idempotent_by_attempt_id(self):
        assessments = self._run(self.api.list_assessments())["assessments"]
        assessment_id = assessments[0]["id"]
        body = self.api.AssessmentSubmitBody(
            attempt_id="attempt-idempotency-check",
            outcome="correct",
            help_used=None,
        )
        first = self._run(self.api.submit_assessment(assessment_id, body))
        second = self._run(self.api.submit_assessment(assessment_id, body))
        self.assertFalse(first["idempotent_replay"])
        self.assertTrue(second["idempotent_replay"])
        self.assertEqual(
            first["assessment"]["evidence_count"], second["assessment"]["evidence_count"]
        )

    def test_hinted_correctness_does_not_bump_evidence_like_independent_success(self):
        assessments = self._run(self.api.list_assessments())["assessments"]
        assessment_id = assessments[0]["id"]
        before = [a for a in assessments if a["id"] == assessment_id][0]["evidence_count"]
        hinted = self.api.AssessmentSubmitBody(
            attempt_id="attempt-hinted",
            outcome="correct_with_hint",
            help_used="1 pista",
        )
        result = self._run(self.api.submit_assessment(assessment_id, hinted))
        self.assertEqual(result["assessment"]["evidence_count"], before)

    def test_invalid_outcome_is_rejected(self):
        assessments = self._run(self.api.list_assessments())["assessments"]
        assessment_id = assessments[0]["id"]
        bad = self.api.AssessmentSubmitBody(attempt_id="x", outcome="not-a-real-outcome")
        with self.assertRaises(Exception):
            self._run(self.api.submit_assessment(assessment_id, bad))

    def test_completing_a_course_session_completes_its_lesson_progress(self):
        """The session checkmark and course progress cannot diverge."""
        now = self.api._now()
        course_id = "course-progress-link"
        lesson_id = "lesson-progress-link"
        session_id = f"session-{course_id}-{lesson_id}"
        with self.api._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {self.api.SCHEMA}.courses "
                "(id, title, chapters_json, sources_json, created_at, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (course_id, "Curso vinculado", "[]", "{}", now, now),
            )
            cur.execute(
                f"INSERT INTO {self.api.SCHEMA}.course_lessons "
                "(id, course_id, title, concepts_json, blocks_json, exercises_json, publication, updated_at) "
                "VALUES (%s, %s, %s, %s, %s, %s, 'ready', %s)",
                (lesson_id, course_id, "Aula vinculada", "[]", "[]", "[]", now),
            )
            cur.execute(
                f"INSERT INTO {self.api.SCHEMA}.tracks "
                "(id, title, stage, status, source_type, source_id, competencies_json, created_at, updated_at) "
                "VALUES (%s, 'Curso vinculado', 'working', 'practicing', 'course', %s, '[]', %s, %s)",
                (f"track-course-{course_id}", course_id, now, now),
            )
            cur.execute(
                f"INSERT INTO {self.api.SCHEMA}.sessions "
                "(id, track_id, kind, planned_topic, planned_date, status, created_at, updated_at) "
                "VALUES (%s, %s, 'lesson', 'Aula vinculada', %s, 'in_progress', %s, %s)",
                (session_id, f"track-course-{course_id}", now[:10], now, now),
            )
            conn.commit()

        completed = self._run(self.api.complete_session(session_id, self.api.SessionCompleteBody()))
        course = self._run(self.api.get_course(course_id))

        self.assertEqual(completed["status"], "completed")
        self.assertEqual(course["lessons"][0]["progress_state"], "completed")
        self.assertEqual(course["progress"]["completed"], 1)

    def test_bundled_timeline_opens_a_lesson_before_allowing_completion(self):
        source = DESKTOP_JS.read_text(encoding="utf-8")
        self.assertIn("Abrir aula", source)
        self.assertIn("session.status === 'planned'", source)
        self.assertIn("/sessions/${session.id}/start", source)

    def test_metrics_course_percentage_uses_completed_lesson_progress(self):
        """Published lessons are available content, not completed study."""
        now = self.api._now()
        course_id = "course-metrics-progress"
        with self.api._connect() as conn, conn.cursor() as cur:
            cur.execute(
                f"INSERT INTO {self.api.SCHEMA}.courses "
                "(id, title, chapters_json, sources_json, created_at, updated_at) "
                "VALUES (%s, %s, '[]', '{}', %s, %s)",
                (course_id, "Curso de métricas", now, now),
            )
            for lesson_id in ("lesson-metrics-1", "lesson-metrics-2"):
                cur.execute(
                    f"INSERT INTO {self.api.SCHEMA}.course_lessons "
                    "(id, course_id, title, concepts_json, blocks_json, exercises_json, publication, updated_at) "
                    "VALUES (%s, %s, %s, '[]', '[]', '[]', 'ready', %s)",
                    (lesson_id, course_id, lesson_id, now),
                )
            cur.execute(
                f"INSERT INTO {self.api.SCHEMA}.lesson_progress "
                "(course_id, lesson_id, state, viewed_at, completed_at, source, updated_at) "
                "VALUES (%s, %s, 'completed', %s, %s, 'test', %s)",
                (course_id, "lesson-metrics-1", now, now, now),
            )
            conn.commit()

        result = self._run(self.api.get_metrics())
        course = next(item for item in result["courses"] if item["course_id"] == course_id)

        self.assertEqual(course["lessons_total"], 2)
        self.assertEqual(course["lessons_ready"], 2)
        self.assertEqual(course["lessons_completed"], 1)
        self.assertEqual(course["lessons_viewed"], 0)
        self.assertEqual(course["lessons_pending"], 1)
        self.assertEqual(course["percent"], 50)

    def test_portal_dialog_source_preserves_progress_protocol_and_a11y_contract(self):
        source = (PLUGIN_DIR / "desktop" / "components" / "portal_dialog.js").read_text(encoding="utf-8")
        lesson_source = (PLUGIN_DIR / "desktop" / "pages" / "lesson.js").read_text(encoding="utf-8")
        self.assertIn("gnos:lesson-progress", source)
        self.assertIn("postApi(`/courses/${message.courseId}/lessons/${message.lessonId}/progress`", source)
        self.assertIn("event.source !== frameRef.current?.contentWindow", source)
        self.assertIn("role: 'dialog'", source)
        self.assertIn("'aria-modal': true", source)
        self.assertIn("'aria-labelledby'", source)
        self.assertIn("'aria-label': 'Fechar'", source)
        self.assertIn("postApi,", lesson_source)
        self.assertIn("host,", lesson_source)

    def test_timeline_mutations_disable_actions_while_request_is_pending(self):
        source = (PLUGIN_DIR / "desktop" / "pages" / "timeline.js").read_text(encoding="utf-8")
        self.assertIn("primary: true, disabled: busy, onClick: saveSchedule", source)
        self.assertIn("icon: 'play', disabled: busy, onClick: () => openSession(session)", source)


if __name__ == "__main__":
    unittest.main()
