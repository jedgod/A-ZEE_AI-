-- 040: each account's recent translations (the text it asked for and the result), so they can be reviewed or cleared.
CREATE TABLE IF NOT EXISTS translations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_lang TEXT NOT NULL CHECK (char_length(target_lang) BETWEEN 2 AND 8),
  source_text TEXT NOT NULL CHECK (char_length(source_text) <= 20000),
  translated_text TEXT NOT NULL CHECK (char_length(translated_text) <= 40000),
  provider TEXT CHECK (provider IS NULL OR char_length(provider) <= 100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS translations_owner ON translations(owner_id, created_at DESC);
