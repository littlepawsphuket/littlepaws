-- Additive migration: existing activities, photos and financial records are untouched.
CREATE TABLE IF NOT EXISTS care_photo_hearts (
  photo_id INTEGER PRIMARY KEY REFERENCES care_photos(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS care_comments (
  id INTEGER PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES care_events(id) ON DELETE CASCADE,
  parent_id INTEGER REFERENCES care_comments(id) ON DELETE CASCADE,
  author_kind TEXT NOT NULL CHECK(author_kind IN ('guardian','staff')),
  staff_user_id INTEGER REFERENCES app_users(id),
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 500),
  created_at TEXT NOT NULL,
  request_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS ix_care_comments_event ON care_comments(event_id,id);
CREATE INDEX IF NOT EXISTS ix_care_comments_parent ON care_comments(parent_id,id);
CREATE TABLE IF NOT EXISTS care_comment_reads (
  user_id INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  comment_id INTEGER NOT NULL REFERENCES care_comments(id) ON DELETE CASCADE,
  read_at TEXT NOT NULL,
  PRIMARY KEY(user_id,comment_id)
);
CREATE INDEX IF NOT EXISTS ix_care_comments_guardian ON care_comments(author_kind,id);

-- Comment tombstones preserve replies and make deletion recoverable.
CREATE TABLE IF NOT EXISTS care_comment_state (
  comment_id INTEGER PRIMARY KEY REFERENCES care_comments(id) ON DELETE CASCADE,
  updated_at TEXT,
  deleted_at TEXT
);
CREATE TABLE IF NOT EXISTS care_comment_likes (
  comment_id INTEGER NOT NULL REFERENCES care_comments(id) ON DELETE CASCADE,
  actor_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(comment_id,actor_key)
);
