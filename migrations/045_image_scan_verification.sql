ALTER TABLE image_scans
  ADD COLUMN IF NOT EXISTS verification JSONB
  CHECK (verification IS NULL OR jsonb_typeof(verification) = 'object');
