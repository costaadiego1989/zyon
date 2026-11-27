CREATE TABLE marketing_contacts (
  merchant_id text NOT NULL, id uuid NOT NULL, identity_key text NOT NULL,
  account_id text, phone text, stage text NOT NULL, origin text NOT NULL,
  updated_at timestamptz NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY (merchant_id, id), UNIQUE (merchant_id, identity_key),
  UNIQUE (merchant_id, account_id), UNIQUE (merchant_id, phone)
);
CREATE INDEX marketing_contacts_stage ON marketing_contacts (merchant_id, stage, updated_at DESC, id);
CREATE TABLE marketing_conversations (
  merchant_id text NOT NULL, id uuid NOT NULL, channel text NOT NULL,
  external_id text NOT NULL, contact_id uuid, updated_at timestamptz NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY (merchant_id, id), UNIQUE (merchant_id, channel, external_id),
  FOREIGN KEY (merchant_id, contact_id) REFERENCES marketing_contacts(merchant_id, id) ON DELETE SET NULL (contact_id)
);
CREATE INDEX marketing_conversations_recent ON marketing_conversations(merchant_id, updated_at DESC);
CREATE TABLE marketing_messages (
  merchant_id text NOT NULL, id uuid NOT NULL, conversation_id uuid NOT NULL,
  dedup_key text NOT NULL, provider_message_id text, created_at timestamptz NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY (merchant_id, id), UNIQUE (merchant_id, dedup_key),
  FOREIGN KEY (merchant_id, conversation_id) REFERENCES marketing_conversations(merchant_id, id) ON DELETE CASCADE
);
CREATE INDEX marketing_messages_conversation ON marketing_messages(merchant_id, conversation_id, created_at, id);
CREATE INDEX marketing_messages_provider ON marketing_messages(merchant_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE TABLE marketing_consents (
  merchant_id text NOT NULL, id uuid NOT NULL, contact_id uuid NOT NULL, channel text NOT NULL,
  recorded_at timestamptz NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY (merchant_id, id), UNIQUE (merchant_id, contact_id, channel)
);
CREATE TABLE marketing_stage_history (
  merchant_id text NOT NULL, id uuid NOT NULL, contact_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL, data jsonb NOT NULL, PRIMARY KEY(merchant_id, id)
);
CREATE INDEX marketing_stage_history_contact ON marketing_stage_history(merchant_id, contact_id, occurred_at DESC);
CREATE TABLE marketing_campaigns (
  merchant_id text NOT NULL, id uuid NOT NULL, status text NOT NULL,
  scheduled_at timestamptz, updated_at timestamptz NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY(merchant_id, id)
);
CREATE INDEX marketing_campaigns_due ON marketing_campaigns(status, scheduled_at) WHERE status IN ('scheduled', 'running');
CREATE TABLE marketing_campaign_recipients (
  merchant_id text NOT NULL, id uuid NOT NULL, campaign_id uuid NOT NULL, contact_id uuid NOT NULL,
  status text NOT NULL, lease_until timestamptz, provider_message_id text, updated_at timestamptz NOT NULL, data jsonb NOT NULL,
  PRIMARY KEY(merchant_id, id), UNIQUE(merchant_id, campaign_id, contact_id),
  FOREIGN KEY(merchant_id, campaign_id) REFERENCES marketing_campaigns(merchant_id, id) ON DELETE CASCADE
);
CREATE INDEX marketing_recipients_due ON marketing_campaign_recipients(merchant_id, campaign_id, status, updated_at);
CREATE INDEX marketing_recipients_provider ON marketing_campaign_recipients(merchant_id, provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE TABLE marketing_settings (merchant_id text PRIMARY KEY, data jsonb NOT NULL);
CREATE TABLE marketing_event_receipts (
  merchant_id text NOT NULL, event_key text NOT NULL, occurred_at timestamptz NOT NULL,
  PRIMARY KEY(merchant_id, event_key)
);
CREATE TABLE marketing_purchase_receipts (
  merchant_id text NOT NULL, order_id text NOT NULL, contact_id uuid NOT NULL, amount_cents integer NOT NULL,
  occurred_at timestamptz NOT NULL, PRIMARY KEY(merchant_id, order_id)
);
CREATE TABLE marketing_commercial_dispatches (
  merchant_id text NOT NULL, contact_key text NOT NULL, dispatch_key text NOT NULL,
  reserved_at timestamptz NOT NULL, PRIMARY KEY(merchant_id, dispatch_key)
);
CREATE INDEX marketing_commercial_dispatches_contact ON marketing_commercial_dispatches(merchant_id, contact_key, reserved_at DESC);
