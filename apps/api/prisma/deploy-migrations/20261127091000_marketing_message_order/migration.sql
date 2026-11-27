ALTER TABLE marketing_messages ADD COLUMN sequence bigint GENERATED ALWAYS AS IDENTITY;
DROP INDEX marketing_messages_conversation;
CREATE INDEX marketing_messages_conversation ON marketing_messages(merchant_id, conversation_id, created_at, sequence);
