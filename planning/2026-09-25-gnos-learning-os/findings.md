# Findings & Decisions

## Requirements

- Preserve the provided GNOS Learning OS prompt kit in the GNOS repository.
- Start the project from the supplied documentation, not from a new discovery interview.
- Phase 1 must be a Hermes Desktop learning dashboard with mock data, stable contracts, and no direct renderer access to internal GNOS files.
- The implementation must preserve the existing GNOS harness and validate it with its repository-provided commands.
- The full roadmap retains UI ↔ contract/API ↔ profile separation; later phases own real persistence, pedagogy, isolated labs, profile integration, and hardening.

## Research Findings

- `/home/prompt/Gnos` was absent and has been cloned from `https://github.com/joaomatheuslf/Gnos.git` at HEAD `52c750e8537ca936a99a93fe95cbd6e958b579b3`.
- GNOS is a Python teaching harness based on skills, scripts, visual tools, teacher SOUL files, a living course plan, and learner records.
- `AGENTS.md` requires the existing harness validator (`python3 skills/learning-orchestrator/scripts/validate_harness.py`) and unit suite (`python3 -m unittest discover -s tests -v`) after changes.
- Existing relevant extension points include `skills/course-viewer/`, `skills/course-design/`, `skills/learner-tracking/`, and `skills/learning-orchestrator/`.
- The Hermes Desktop plugin skill requires reading the current checked-out SDK document and source before using any SDK export. Unified plugins use one source package with `desktop/plugin.js` and optionally `dashboard/plugin_api.py`; the desktop file must use plain ESM and no JSX.

## Technical Decisions

| Decision | Rationale |
|----------|-----------|
| Store prompt kit in `docs/gnos-learning-os/` | Keeps product requirements with the source code and review history. |
| Build the plugin as a unified package rather than fork Hermes Desktop | This follows the supported Desktop plugin model and the requested no-core-modification constraint. |
| Use mock adapter data in Phase 1 | Makes the dashboard navigable while retaining the clean seam required for a later profile/backend implementation. |
| Treat GNOS learner records and lesson material as data, not plugin instructions | Preserves the GNOS repository security boundary from `AGENTS.md`. |

## Issues Encountered

| Issue | Resolution |
|-------|------------|
| No local GNOS clone was present | Cloned the requested repository to `/home/prompt/Gnos`. |

## Resources

- `docs/gnos-learning-os/00_README.md` through `06_MASTER_BUILD.md`
- `AGENTS.md`
- `README.md`
- `skills/course-viewer/SKILL.md`
- `skills/learner-tracking/SKILL.md`
- Hermes Desktop SDK document and `apps/desktop/src/sdk/index.ts` (pending inspection)

## Visual/Browser Findings

- No visual runtime evidence has been captured yet. Phase 4 will verify the plugin in the Desktop runtime if the locally installed app/runtime is available.
