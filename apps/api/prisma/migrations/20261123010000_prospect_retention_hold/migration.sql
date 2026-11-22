BEGIN;

CREATE OR REPLACE FUNCTION prospect_retention_text_present(value TEXT)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(value ~ U&'[^[:space:]\0085\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]', false)
$$;

ALTER TABLE platform_prospects ADD CONSTRAINT prospect_retention_hold_meaningful CHECK (
  (retention_hold_reason IS NULL AND retention_authorization_ref IS NULL) OR
  (prospect_retention_text_present(retention_hold_reason) AND prospect_retention_text_present(retention_authorization_ref))
) NOT VALID;

UPDATE platform_prospects
SET retention_hold_reason = NULL, retention_authorization_ref = NULL
WHERE (retention_hold_reason IS NOT NULL OR retention_authorization_ref IS NOT NULL)
  AND NOT (prospect_retention_text_present(retention_hold_reason) AND prospect_retention_text_present(retention_authorization_ref));

ALTER TABLE platform_prospects VALIDATE CONSTRAINT prospect_retention_hold_meaningful;
COMMIT;
