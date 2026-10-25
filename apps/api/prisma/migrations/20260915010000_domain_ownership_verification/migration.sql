ALTER TABLE "merchant_domains" ADD COLUMN "ownership_verified_at" TIMESTAMP(3);
-- Existing CNAME-only registrations must complete the TXT challenge before
-- routing or certificate issuance. No domain records or prior audit dates are deleted.
