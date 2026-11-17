CREATE TABLE IF NOT EXISTS staff_access_identities (
    email TEXT PRIMARY KEY CHECK(email = lower(trim(email)) AND length(email) > 0),
    user_id INTEGER NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE
);
