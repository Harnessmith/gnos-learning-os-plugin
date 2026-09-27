ALTER TABLE gnos_learning_os.timeline_entries
    ADD COLUMN IF NOT EXISTS track_id TEXT REFERENCES gnos_learning_os.tracks(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_gnos_timeline_track
    ON gnos_learning_os.timeline_entries(track_id);
