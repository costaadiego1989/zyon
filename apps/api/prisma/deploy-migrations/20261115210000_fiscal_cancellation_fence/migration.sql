ALTER TABLE fiscal_intents ADD COLUMN lease_purpose TEXT;
-- Fiscal cancellation custom invariants (also applied after fixture db push).
ALTER TABLE fiscal_intents ADD CONSTRAINT fiscal_lease_purpose CHECK (lease_purpose IS NULL OR lease_purpose IN ('issuance','query','cancellation'));
