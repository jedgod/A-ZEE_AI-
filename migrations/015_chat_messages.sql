-- 015: chat messages saved to the account (sidebar → open any saved chat, GET /api/chats/:id).
-- Until now only title/project/pin were stored and messages lived in one browser's storage.
-- Scoped to the owner like the rest of the chat row; deleting a chat deletes its messages.

ALTER TABLE chats ADD COLUMN IF NOT EXISTS messages JSONB NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
  ALTER TABLE chats ADD CONSTRAINT chats_messages_shape
    CHECK (jsonb_typeof(messages) = 'array' AND jsonb_array_length(messages) <= 200 AND octet_length(messages::text) <= 3000000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE chats ADD COLUMN IF NOT EXISTS message_count INTEGER GENERATED ALWAYS AS (jsonb_array_length(messages)) STORED;
