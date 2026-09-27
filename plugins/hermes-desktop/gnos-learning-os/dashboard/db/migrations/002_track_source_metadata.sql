ALTER TABLE gnos_learning_os.tracks
    ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'user';

ALTER TABLE gnos_learning_os.tracks
    ADD COLUMN IF NOT EXISTS source_id TEXT;

CREATE INDEX IF NOT EXISTS idx_gnos_tracks_source
    ON gnos_learning_os.tracks(source_type, source_id);
