-- AZLinqext "suggest as I type": a separate, opt-in consent, and a record of how each request was
-- triggered so the server can enforce its own pacing and daily cap for typing-triggered suggestions.
ALTER TABLE linqext_consents ADD COLUMN IF NOT EXISTS typing BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE linqext_requests ADD COLUMN IF NOT EXISTS trigger TEXT NOT NULL DEFAULT 'tap' CHECK (trigger IN ('tap', 'typing'));
CREATE INDEX IF NOT EXISTS linqext_requests_typing ON linqext_requests (user_id, created_at DESC) WHERE trigger = 'typing';
