CREATE TABLE IF NOT EXISTS image_caption_checks (
  scan_id UUID PRIMARY KEY REFERENCES image_scans(id) ON DELETE CASCADE,
  caption TEXT NOT NULL CHECK (char_length(caption) BETWEEN 1 AND 1000),
  result JSONB NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  checked_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
