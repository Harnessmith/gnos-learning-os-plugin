# Task Plan: GNOS Learning OS + Hermes Desktop plugin

## Goal

Start GNOS Learning OS by preserving the supplied specifications in the GNOS repository, validating the existing harness, and delivering a verified mock-backed Hermes Desktop plugin foundation with stable UI contracts.

## Next Step

Begin Phase 4: versioned contract exchange with the GNOS profile itself (today the backend serves seeded/local state; it does not yet read the real `Gnos` skills/course data).

## Current Phase

Phase 4 — GNOS profile integration

## Phases

### Phase 1: Discovery and baseline validation

- [x] Clone `joaomatheuslf/Gnos` into `/home/prompt/Gnos`.
- [x] Copy the seven supplied GNOS Learning OS documents to `docs/gnos-learning-os/`.
- [x] Read repository guidance, GNOS extension skills, course-viewer code, current Hermes SDK references, and official plugin documentation.
- [x] Run the existing harness validator and regression suite; record the environment-limited browser baseline.
- **Status:** complete

### Phase 2: Desktop Plugin V1

- [x] Document confirmed Hermes SDK APIs and UI-facing contracts.
- [x] Build an installable unified plugin package without changing Hermes core.
- [x] Implement navigable Today, Tracks, Timeline, Lesson, Labs, Assessments, Progress, Resources, and Projects views.
- [x] Implement the mock DevOps/Docker lesson, DNS failure, adaptive repair entry, lab, result context, and next session.
- [x] Add package documentation, static contract tests, and run plugin validation/doctor.
- [x] Install as an enabled local Hermes plugin.
- **Status:** complete

### Phase 3: Local backend, persistence and contracts

- [x] Implement a supported plugin backend route/service boundary (`dashboard/manifest.json` + `dashboard/plugin_api.py`, mounted by the gateway at `/api/plugins/gnos-learning-os/*`).
- [x] Persist dashboard/session/timeline history transactionally without overwriting plan history (SQLite; `sessions_actual` and `lab_checks` are append-only; `sessions_planned` is never mutated by session/lab actions).
- [x] Replace `mockGateway` with an API implementation behind the same contract (`ctx.rest` bound once in `activate()`; renderer has zero direct GNOS/file/shell access — enforced by `test_reads_exclusively_through_the_plugin_backend`).
- [x] Add the restricted mock lab-runner abstraction; no shell execution in Hermes (`check_lab` runs a deterministic, seeded state machine — no `subprocess`/`child_process` anywhere in the plugin).
- **Status:** complete
- Verification:
  - Headless functional test against the real module (isolated SQLite per test): idempotent assessment submission by `attempt_id`, hinted-vs-independent evidence semantics, lab lifecycle (`start`/`check`/`reset`) never deletes `lab_checks` history, `sessions_planned` immutable across session actions.
  - `hermes plugins validate` and `hermes plugins doctor --ci` pass after adding the backend half.
  - Backend actually mounted end-to-end: added `gnos-learning-os` to `~/.hermes/config.yaml` `plugins.enabled`, restarted the real gateway process, and confirmed `GET /api/plugins/gnos-learning-os/today` returns `401 Unauthorized` (route exists and is auth-protected) rather than `404` — proof the FastAPI router is live, not just import-checked.
  - Full repo suite: 207 tests, 0 failures, 7 skipped (optional media/PDF deps + Playwright unavailable, both pre-existing environment limits, not regressions).

### Phase 4: GNOS profile integration

- [ ] Implement versioned contract exchange with the GNOS profile.
- [ ] Preserve pedagogical evidence semantics and current course/harness constraints.
- [ ] Add adaptive scheduler and resource/research adapters.
- **Status:** pending

### Phase 5: End-to-end QA and hardening

- [ ] Exercise `Hoje → Aula → Lab → Resultado → Próxima sessão` against the real backend.
- [ ] Add contract, timeline, evidence, lab-isolation, and profile-unavailable tests.
- [ ] Resolve host browser prerequisite to run browser E2E.
- [ ] Commit only after QA passes and repository state is reviewed.
- **Status:** pending

## Confirmed Decisions

| Decision | Rationale |
|---|---|
| Keep user-provided documents in `docs/gnos-learning-os/` | Makes scope versioned with the implementation. |
| Extend Hermes through public SDK contributions | Current SDK confirms `ROUTES_AREA`, `SIDEBAR_NAV_AREA`, `PALETTE_AREA`, and `host.navigate`; no core fork is needed. |
| Keep UI renderer-only in V1 | Prevents direct GNOS-file access and avoids putting pedagogical rules or command execution in the renderer. |
| Preserve planned versus actual timelines | This is a non-negotiable contract for later adaptation and evidence history. |

## QA Baseline

- Harness validation succeeded.
- Full existing Python suite: 198 run; 191 passed; 6 optional media/PDF tests skipped; 1 browser test failed before assertions because Chrome is absent at `/opt/google/chrome/chrome`.
- Plugin V1: static test, syntax check, `hermes plugins validate`, and `hermes plugins doctor --ci` all succeeded.
