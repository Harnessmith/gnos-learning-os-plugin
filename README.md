# GNOS Learning OS — Hermes Desktop Plugin

Hermes Desktop plugin that surfaces the [GNOS learning harness](https://github.com/madhvantyagi/Gnos)
as a native dashboard: today's session, lab lifecycle, and durable evidence
tracking, backed by a real API instead of a mock.

This repo is **separate from and does not modify** the upstream GNOS harness
(skills/teachers/tests). It is an independent Hermes Desktop integration that
talks to that harness's data model.

## Layout

- `plugins/hermes-desktop/gnos-learning-os/` — the plugin itself
  - `dashboard/plugin_api.py` — FastAPI backend, mounted by the Hermes gateway
    at `/api/plugins/gnos-learning-os/`. Persists to **PostgreSQL** (schema
    `gnos_learning_os`), not SQLite — credentials are read from `~/.pgpass`
    via libpq's `passfile` option, never hardcoded.
  - `desktop/plugin.js` — renderer, talks to the backend exclusively via
    `ctx.rest` (no direct DB/shell access from the UI layer).
  - `plugin.yaml` — manifest; declares `psycopg[binary]` as a Python
    dependency so `hermes plugins enable` installs it into the gateway venv.
- `docs/gnos-learning-os/` — design docs (numbered 00–06: README, plugin V1,
  backend contracts, profile integration, tests/acceptance, master build).
- `tests/test_gnos_plugin_v2.py` — contract tests for the renderer (route
  declarations, ctx.rest-only access) and the backend (idempotency,
  append-only evidence history, lab lifecycle invariants). Run against a
  throwaway Postgres schema per test.
- `planning/2026-09-25-gnos-learning-os/` — planning-with-files artifacts
  (task plan, progress log, findings) from the build.

## Requirements

- A reachable PostgreSQL instance. Defaults assume a local instance with a
  `~/.pgpass` entry for database `memory`, user `memory` — override via
  `GNOS_PG_HOST` / `GNOS_PG_PORT` / `GNOS_PG_DB` / `GNOS_PG_USER` /
  `GNOS_PG_SCHEMA` env vars for other environments.
- `psycopg[binary]>=3.1,<4` (installed automatically when the plugin is
  enabled through Hermes; install manually into the same interpreter for
  local test runs: `pip install "psycopg[binary]>=3.1,<4"`).

## Install into Hermes

```sh
cp -r plugins/hermes-desktop/gnos-learning-os ~/.hermes/plugins/
# add "gnos-learning-os" to plugins.enabled in ~/.hermes/config.yaml
hermes plugins validate ~/.hermes/plugins/gnos-learning-os
hermes plugins doctor ~/.hermes/plugins/gnos-learning-os --ci
hermes gateway restart
```

## Test

```sh
python3 -m unittest discover -s tests -v
```
