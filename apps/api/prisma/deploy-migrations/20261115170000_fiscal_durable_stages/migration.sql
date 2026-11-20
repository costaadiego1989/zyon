ALTER TABLE fiscal_intents ADD COLUMN issuance_revision INTEGER NOT NULL DEFAULT 1 CHECK (issuance_revision > 0);
CREATE TABLE fiscal_issuance_revisions (
 id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, environment "FiscalEnvironment" NOT NULL, intent_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK (revision > 0), profile_version_id TEXT NOT NULL, issued_at TIMESTAMPTZ(3) NOT NULL,
 payload JSONB NOT NULL, payload_hash CHAR(64) NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'), payment_evidence JSONB NOT NULL,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fiscal_issuance_revisions_operation UNIQUE (intent_id, revision),
 FOREIGN KEY (intent_id, merchant_id, environment) REFERENCES fiscal_intents(id, merchant_id, environment) ON DELETE RESTRICT
);
CREATE INDEX fiscal_issuance_revisions_scope ON fiscal_issuance_revisions(merchant_id, environment, intent_id);
CREATE TABLE fiscal_provider_stage_receipts (
 id TEXT PRIMARY KEY, merchant_id TEXT NOT NULL, environment "FiscalEnvironment" NOT NULL, intent_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK (revision >= 0), stage TEXT NOT NULL CHECK(stage IN ('contact.create','order.create','invoice.generate','invoice.validate','invoice.submit','invoice.cancel')),
 reference TEXT NOT NULL, outcome TEXT NOT NULL CHECK(outcome IN ('started','accepted','unknown','not_accepted')),
 payload_hash CHAR(64) CHECK(payload_hash ~ '^[a-f0-9]{64}$'), remote_id TEXT, related_ids JSONB, reason_code TEXT,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT fiscal_provider_stages_operation UNIQUE (intent_id, revision, stage),
 FOREIGN KEY (intent_id, merchant_id, environment) REFERENCES fiscal_intents(id, merchant_id, environment) ON DELETE RESTRICT
);
CREATE INDEX fiscal_provider_stages_scope ON fiscal_provider_stage_receipts(merchant_id, environment, intent_id);
-- Fiscal durable-stage custom invariants
CREATE FUNCTION fiscal_issuance_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'fiscal_issuance_revision_immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER fiscal_issuance_revision_no_mutation BEFORE UPDATE OR DELETE ON fiscal_issuance_revisions FOR EACH ROW EXECUTE FUNCTION fiscal_issuance_revision_immutable();
