-- Retention checks unresolved outgoing attempts without scanning whole transcripts.
CREATE INDEX IF NOT EXISTS marketing_messages_unresolved_idx
  ON marketing_messages(merchant_id, conversation_id)
  WHERE (data->>'status') IN ('sending', 'unknown');
