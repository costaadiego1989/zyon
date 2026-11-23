-- Municipality lookups correlate by snapshot and city, optionally by UF.
-- The status-first index cannot bound this lookup when status is absent.
CREATE INDEX IF NOT EXISTS "company_establishments_snapshot_city_uf_cnpj_idx"
ON "company_directory"."company_establishments" ("snapshot_id", "city_code", "uf", "cnpj");
