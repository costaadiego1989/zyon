-- Custom domains (MerchantDomain): lets a merchant point their own domain
-- (e.g. loja.cliente.com.br) at the storefront. A verified record is resolved
-- by GetStoreConfigUseCase (host → merchant) and gates Caddy On-Demand TLS.
-- Idempotent: the table already exists in environments provisioned via
-- `prisma db push`; this makes it a versioned migration for `migrate deploy`
-- (production) so the table is created there too.
CREATE TABLE IF NOT EXISTS "merchant_domains" (
    "id"            TEXT NOT NULL,
    "merchant_id"   TEXT NOT NULL,
    "domain"        TEXT NOT NULL,
    "verified"      BOOLEAN NOT NULL DEFAULT false,
    "cname_target"  TEXT NOT NULL DEFAULT 'stores.zyon.com',
    "verified_at"   TIMESTAMP(3),
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "merchant_domains_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "merchant_domains_domain_key" ON "merchant_domains"("domain");
CREATE INDEX IF NOT EXISTS "merchant_domains_merchant_id_idx" ON "merchant_domains"("merchant_id");
