-- Add free_shipping flag to storefront_carts.
-- Set by the deterministic cart rules engine when a matched advanced rule grants
-- free shipping. Nullable-safe: default false, no backfill needed, zero risk to
-- existing rows.
ALTER TABLE "storefront_carts" ADD COLUMN IF NOT EXISTS "free_shipping" BOOLEAN NOT NULL DEFAULT false;
