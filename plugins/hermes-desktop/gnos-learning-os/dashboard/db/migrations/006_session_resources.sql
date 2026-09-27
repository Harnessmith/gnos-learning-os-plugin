CREATE TABLE IF NOT EXISTS gnos_learning_os.session_resources (
    session_id TEXT NOT NULL REFERENCES gnos_learning_os.sessions(id) ON DELETE CASCADE,
    resource_id TEXT NOT NULL REFERENCES gnos_learning_os.resources(id) ON DELETE CASCADE,
    used_at TEXT NOT NULL,
    PRIMARY KEY (session_id, resource_id)
);
