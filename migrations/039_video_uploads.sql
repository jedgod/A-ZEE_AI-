-- 039: source clips uploaded for Edit Video. The clip is hosted temporarily so the video provider can fetch it,
-- and is deleted as soon as its job finishes (or after a few hours if it was never used). The row records which
-- account uploaded it, so a job can only use, and only ever delete, the uploads its own account made.
CREATE TABLE IF NOT EXISTS video_uploads (
  file_key TEXT PRIMARY KEY CHECK (char_length(file_key) <= 200),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL CHECK (char_length(url) <= 2048),
  file_name TEXT CHECK (file_name IS NULL OR char_length(file_name) <= 200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS video_uploads_owner ON video_uploads(owner_id, created_at DESC);
