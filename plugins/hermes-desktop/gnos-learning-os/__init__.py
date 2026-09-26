"""GNOS Learning OS plugin package.

Desktop UI contributions live in desktop/plugin.js. This intentionally performs
no backend registration in V1; API and profile integration are later phases.
"""


def register(ctx):
    """Expose a loadable plugin package while V1 is renderer-only."""
    return None
