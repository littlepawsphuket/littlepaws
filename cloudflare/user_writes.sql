CREATE TABLE IF NOT EXISTS staff_credential_attempts (
  actor_id INTEGER PRIMARY KEY REFERENCES app_users(id),
  window INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_security_events (
  id INTEGER PRIMARY KEY,
  actor_id INTEGER NOT NULL REFERENCES app_users(id),
  subject_id INTEGER REFERENCES app_users(id),
  stay_id INTEGER REFERENCES stays(id),
  action TEXT NOT NULL,
  recorded_at TEXT NOT NULL
);
