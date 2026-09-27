ALTER TABLE gnos_learning_os.resources
    ADD COLUMN IF NOT EXISTS folder_id TEXT;
ALTER TABLE gnos_learning_os.resources
    ADD COLUMN IF NOT EXISTS lesson_id TEXT;
ALTER TABLE gnos_learning_os.resources
    ADD COLUMN IF NOT EXISTS competency_id TEXT;

CREATE INDEX IF NOT EXISTS idx_gnos_resources_lesson
    ON gnos_learning_os.resources(lesson_id);
CREATE INDEX IF NOT EXISTS idx_gnos_resources_competency
    ON gnos_learning_os.resources(competency_id);
