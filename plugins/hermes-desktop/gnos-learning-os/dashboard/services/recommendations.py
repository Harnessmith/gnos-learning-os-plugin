"""Pure prioritization rules for the personal study dashboard."""
from __future__ import annotations


def choose_next(active: dict | None, repair: dict | None, planned: dict | None) -> tuple[str, str, dict | None]:
    if active:
        return "session", "sessão em andamento", active
    if repair:
        return "repair", "competência precisa de reparo", repair
    if planned:
        return "lesson", "próxima sessão planejada", planned
    return "empty", "nenhuma ação pendente", None
