-- Video bytes and thumbnails remain in private R2; D1 stores metadata only.
CREATE TABLE IF NOT EXISTS care_videos (
 id INTEGER PRIMARY KEY,
 event_id INTEGER NOT NULL REFERENCES care_events(id) ON DELETE CASCADE,
 object_key TEXT NOT NULL UNIQUE,
 poster_key TEXT,
 byte_size INTEGER NOT NULL CHECK(byte_size BETWEEN 1 AND 50000000),
 duration_ms INTEGER NOT NULL CHECK(duration_ms BETWEEN 1 AND 30000),
 mime TEXT NOT NULL CHECK(mime IN ('video/mp4','video/quicktime')),
 codec TEXT NOT NULL,
 cloud_upload_key TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS care_videos_event ON care_videos(event_id);
