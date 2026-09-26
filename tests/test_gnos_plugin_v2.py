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
        self.assertNotIn("fetch(", self.source)
        # Every read/write must go through ctx.rest, bound once in activate().
        self.assertIn("ctx.rest(path, opts)", self.source)
        self.assertIn("function rest(path, opts)", self.source)

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

    def tearDown(self):
        with self.api._connect() as conn, conn.cursor() as cur:
            cur.execute(f"DROP SCHEMA IF EXISTS {self._schema} CASCADE")
            conn.commit()
        self.api._conninfo = self._orig_conninfo
        self.api.SCHEMA = self._orig_schema_const
        self.api._SCHEMA_DDL = self._orig_ddl

    def _run(self, coro):
        return asyncio.run(coro)

    def test_today_reflects_seeded_in_progress_session(self):
        today = self._run(self.api.get_today())
        self.assertEqual(today["status"], "in_progress")
        self.assertIn("Docker Networking", today["session"])

    def test_timeline_planned_is_never_mutated_by_session_actions(self):
        before = self._run(self.api.get_timeline())
        planned_before = before["planned"]
        self._run(self.api.start_session("session-docker-networking"))
        self._run(
            self.api.complete_session(
                "session-docker-networking",
                self.api.SessionCompleteBody(next_step="Novo próximo passo"),
            )
        )
        after = self._run(self.api.get_timeline())
        self.assertEqual(planned_before, after["planned"])
        self.assertGreater(len(after["actual"]), len(before["actual"]))

    def test_lab_lifecycle_start_check_reset_never_deletes_check_history(self):
        lab_id = "lab-dns-entre-containers"
        labs = self._run(self.api.list_labs())["labs"]
        self.assertIn(lab_id, [lab["id"] for lab in labs])
        self._run(self.api.start_lab(lab_id))
        checked = self._run(self.api.check_lab(lab_id))
        self.assertEqual(checked["status"], "failed")  # seeded lab is not yet fixed
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


if __name__ == "__main__":
    unittest.main()
