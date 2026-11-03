-- 013: project Edit (description) and Settings (instructions for every chat in the project,
-- default mode for new chats). Instructions are the user's own text and go to the AI with
-- each message in the project, like Personalization's custom instructions.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''
  CHECK (length(description) <= 500);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS instructions TEXT NOT NULL DEFAULT ''
  CHECK (length(instructions) <= 4000);
ALTER TABLE projects ADD COLUMN IF NOT EXISTS default_mode TEXT NOT NULL DEFAULT 'chat'
  CHECK (default_mode IN ('chat', 'code', 'research'));
