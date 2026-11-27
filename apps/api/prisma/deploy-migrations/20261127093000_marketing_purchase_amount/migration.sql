-- Completed orders support amounts above signed 32-bit cents.
ALTER TABLE marketing_purchase_receipts ALTER COLUMN amount_cents TYPE bigint;
