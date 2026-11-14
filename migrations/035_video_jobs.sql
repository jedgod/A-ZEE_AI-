-- 035: background media jobs (video create/edit). A job is created for its owner, handed to a video
-- provider, and finished by the provider's webhook. Status only moves processing -> completed|failed.
CREATE TABLE IF NOT EXISTS media_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('create_video', 'edit_video')),
  status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'completed', 'failed')),
  prompt TEXT NOT NULL CHECK (char_length(prompt) BETWEEN 1 AND 4000),
  input_url TEXT CHECK (input_url IS NULL OR char_length(input_url) <= 2048),
  output_url TEXT CHECK (output_url IS NULL OR char_length(output_url) <= 2048),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_jobs_owner ON media_jobs(owner_id, created_at DESC);
