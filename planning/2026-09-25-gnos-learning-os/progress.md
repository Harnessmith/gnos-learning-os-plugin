# Progress Log

## Session: 2026-09-25

### Phase 1: Discovery and baseline validation

- **Status:** complete
- **Started:** 2026-09-25 (UTC-03:00)
- Actions taken:
  - Read the supplied GNOS Learning OS specification set.
  - Copied it verbatim to `docs/gnos-learning-os/`.
  - Cloned and inspected the existing `Gnos` repository and its learner harness.
  - Inspected the installed Hermes Desktop SDK and official plugin documentation before creating any extension.
  - Ran the existing harness and full regression suite.
- Result:
  - Harness validation passed.
  - The suite ran 198 tests: 191 passed, 6 were skipped (optional media/PDF dependencies), and 1 browser test could not launch because this host lacks Chrome at `/opt/google/chrome/chrome`.
  - This is an environment prerequisite, not a regression from the GNOS plugin V1.

### Phase 2: Desktop Plugin V1

- **Status:** complete (mock-backed UI)
- Implemented package: `plugins/hermes-desktop/gnos-learning-os/`.
- Added the 9 planned routes and sidebar navigation:
  - Hoje, Trilhas, Cronograma, Aula, Laboratórios, Avaliações, Progresso, Recursos, Projetos.
- Used current public Hermes SDK contributions only:
  - `ROUTES_AREA`, `SIDEBAR_NAV_AREA`, `PALETTE_AREA`, `host.navigate`.
- Added deterministic DevOps/Docker mocks and an explicit `mockGateway` boundary.
- Added `contracts.md` and renderer static-contract tests.
- Symlinked and enabled the local plugin as `~/.hermes/plugins/gnos-learning-os`.
- Verification:
  - `node --check` passed.
  - static contract tests passed.
  - `hermes plugins validate ... --json` passed (security scan safe).
  - `hermes plugins doctor ... --ci` passed (runtime discovery/import/registration).
  - Plugin status reported `enabled`; Hermes says it takes effect in the next session.

### Next phase

- Phase 3 is complete (see below).
- Phase 4 is the versioned contract exchange with the real GNOS profile (courses, learner state, evidence) — the current backend is a self-contained SQLite store seeded with the DevOps/Docker journey, not yet wired to `skills/learner-tracking` or `skills/course-viewer`.

### Phase 3: Local plugin backend (real persistence, no more mock)

- **Status:** complete
- Added `plugins/hermes-desktop/gnos-learning-os/dashboard/`:
  - `manifest.json` — declares `plugin_api.py` as this plugin's backend half.
  - `plugin_api.py` — FastAPI `APIRouter` + SQLite (lazily created under the plugin's own writable dir), one table per contract entity (`sessions_planned`, `sessions_actual`, `labs`, `lab_checks`, `assessments`, `tracks`, `evidence`, `resources`, `projects`), seeded once with the same DevOps/Docker-Networking journey used in the V1 mock.
  - Endpoints: `GET /today`, `/tracks`, `/timeline`, `/sessions/{id}`, `/labs/{id}`, `/assessments`, `/evidence`, `/resources`, `/projects`; `POST /sessions/{id}/start`, `/sessions/{id}/complete`, `/labs/{id}/start`, `/labs/{id}/check`, `/labs/{id}/reset`, `/assessments/{id}/submit`.
  - Invariants enforced in code (not just docs): `sessions_planned` rows are never updated/deleted by any endpoint; `lab_checks` is append-only (reset clears live sandbox state but keeps prior check rows); assessment submission is idempotent keyed by client-supplied `attempt_id`; hinted correctness (`correct_with_hint`) does not increment `evidence_count` the way independent `correct` does.
- Rewired `desktop/plugin.js`: removed `const mockGateway` entirely; every page now reads through a `useApi`/`postApi` pair that calls `ctx.rest(path, opts)` (bound once in `activate()`), with explicit loading/error/empty states per page instead of instant mock data.
- Registered the plugin's backend in the real gateway: added `gnos-learning-os` to `~/.hermes/config.yaml` under `plugins.enabled`, restarted the gateway process, and confirmed in `~/.hermes/logs/gateway.log` that it logs `Mounted plugin API routes: /api/plugins/gnos-learning-os/`. A live `curl` against `/today` returns `401 Unauthorized` (not `404`), proving the router is mounted and behind the same auth as every other plugin API.
- Test suite renamed `tests/test_gnos_plugin_v1.py` → `tests/test_gnos_plugin_v2.py` (V1's static-mock assertions no longer apply) and split into a renderer-boundary test class plus a headless functional test class that imports `plugin_api` directly and points it at a throwaway SQLite file per test. Caught and fixed one real bug in the process: every write endpoint was missing the `_ensure_seeded()` call the read endpoints had, so calling e.g. `start_lab` before any `GET` raised `sqlite3.OperationalError: no such table: labs`.
- Full regression: `python3 -m unittest discover -s tests` → 207 tests, 0 failures, 7 skipped (media/PDF optional deps + Playwright unavailable — pre-existing environment gaps, unrelated to this change). `hermes plugins validate` and `hermes plugins doctor --ci` both still pass.
