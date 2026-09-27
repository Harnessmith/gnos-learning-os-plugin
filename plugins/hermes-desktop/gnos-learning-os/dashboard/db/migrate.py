"""Database migration helpers for the GNOS plugin.

Migrations are additive and idempotent. The application keeps the existing
schema bootstrap for backwards compatibility, while deployments can use this
module to record and apply explicit migration versions.
"""
from __future__ import annotations

import re
from pathlib import Path

from importlib import import_module

plugin_api = import_module("plugin_api")

MIGRATIONS_DIR = Path(__file__).with_name("migrations")


def _migration_files() -> list[Path]:
    return sorted(MIGRATIONS_DIR.glob("[0-9][0-9][0-9]_*.sql"))


def apply_migrations() -> list[str]:
    """Apply unapplied SQL migrations and return their version names."""
    plugin_api._ensure_schema()
    with plugin_api._connect() as conn, conn.cursor() as cur:
        cur.execute(
            f"""CREATE TABLE IF NOT EXISTS {plugin_api.SCHEMA}.schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL
            )"""
        )
        cur.execute(f"SELECT version FROM {plugin_api.SCHEMA}.schema_migrations")
        applied = {row["version"] for row in cur.fetchall()}
        newly_applied: list[str] = []
        for path in _migration_files():
            version = path.stem
            if version in applied:
                continue
            sql = path.read_text(encoding="utf-8")
            # Migration files are repository-owned; reject unexpected schema
            # references rather than interpolating arbitrary identifiers.
            if not re.search(r"gnos_learning_os", sql):
                raise ValueError(f"migration {version} must reference the GNOS schema")
            cur.execute(sql)
            cur.execute(
                f"INSERT INTO {plugin_api.SCHEMA}.schema_migrations (version, applied_at) VALUES (%s, %s)",
                (version, plugin_api._now()),
            )
            newly_applied.append(version)
        conn.commit()
    return newly_applied
