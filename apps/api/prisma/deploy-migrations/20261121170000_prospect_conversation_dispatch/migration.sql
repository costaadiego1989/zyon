ALTER TABLE platform_prospects ADD COLUMN first_delivered_at timestamp(3);
ALTER TABLE prospect_conversations ADD COLUMN revision integer NOT NULL DEFAULT 0;
CREATE TABLE prospect_conversation_changes (
 id text PRIMARY KEY, conversation_id text NOT NULL REFERENCES prospect_conversations(id),
 revision integer NOT NULL, kind text NOT NULL, sequence integer, occurred_at timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(conversation_id,revision)
);
ALTER TABLE prospect_messages ADD COLUMN client_request_id text UNIQUE, ADD COLUMN control_epoch integer,
 ADD COLUMN sender_version integer, ADD COLUMN campaign_id text REFERENCES prospect_campaigns(id),
 ADD COLUMN reserved_amount bigint NOT NULL DEFAULT 0 CHECK(reserved_amount>=0),
 ADD COLUMN cost_state text NOT NULL DEFAULT 'none', ADD COLUMN submitted_at timestamp(3),
 ADD COLUMN accepted_at timestamp(3), ADD COLUMN error_code text;
CREATE UNIQUE INDEX prospect_messages_automatic_attempt ON prospect_messages(attempt_id) WHERE attempt_id IS NOT NULL;
