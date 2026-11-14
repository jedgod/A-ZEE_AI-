-- 036: results of AI-image checks (verdict, scores, clues). The image itself is not stored.
CREATE TABLE IF NOT EXISTS image_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verdict TEXT NOT NULL CHECK (verdict IN ('AI_GENERATED', 'LIKELY_REAL', 'INCONCLUSIVE')),
  confidence INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
  pixel_scores JSONB CHECK (pixel_scores IS NULL OR jsonb_typeof(pixel_scores) = 'object'),
  likely_source TEXT CHECK (likely_source IS NULL OR char_length(likely_source) <= 200),
  signals JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(signals) = 'array' AND jsonb_array_length(signals) <= 20),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS image_scans_owner ON image_scans(owner_id, created_at DESC);
