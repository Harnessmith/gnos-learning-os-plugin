-- 007_lesson_progress: reading/completion state per course lesson.
--
-- Answers "how does the system know a lesson (and its subject) was
-- consulted?": opening a lesson in the reader registers `viewed`; the explicit
-- "Concluir esta aula" action registers `completed`. Status never downgrades —
-- a completed lesson that is reopened stays completed.
CREATE TABLE IF NOT EXISTS gnos_learning_os.lesson_progress (
    course_id TEXT NOT NULL REFERENCES gnos_learning_os.courses(id) ON DELETE CASCADE,
    lesson_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'viewed',
    viewed_at TEXT,
    completed_at TEXT,
    source TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (course_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_lesson_progress_course
    ON gnos_learning_os.lesson_progress(course_id, state);

INSERT INTO gnos_learning_os.schema_migrations (version, applied_at)
VALUES ('007_lesson_progress', now()::text)
ON CONFLICT (version) DO NOTHING;
