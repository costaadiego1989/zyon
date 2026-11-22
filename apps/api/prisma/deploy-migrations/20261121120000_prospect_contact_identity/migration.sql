ALTER TABLE prospect_endpoints ADD COLUMN identity_kind TEXT NOT NULL DEFAULT 'phone', ADD COLUMN business_scope TEXT;
UPDATE prospect_endpoints SET identity_kind='email' WHERE channel='email';
ALTER TABLE prospect_endpoints ADD CONSTRAINT prospect_endpoint_identity_scope CHECK (
  (identity_kind='bsuid' AND channel='whatsapp' AND business_scope IS NOT NULL AND length(business_scope)>0)
  OR (identity_kind='phone' AND channel='whatsapp' AND business_scope IS NULL)
  OR (identity_kind='email' AND channel='email' AND business_scope IS NULL)
);
ALTER TABLE prospect_commands ADD COLUMN resource_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
