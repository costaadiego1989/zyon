-- AlterTable
ALTER TABLE "merchant_rules" ADD COLUMN     "origin_zip" TEXT;

-- Backfill origin ZIP from the previous shipping profile table before collapsing
-- the setting into merchant rules.
UPDATE "merchant_rules" AS mr
SET "origin_zip" = msp."origin_zip"
FROM "merchant_shipping_profiles" AS msp
WHERE mr."merchant_id" = msp."merchant_id";

-- DropTable
DROP TABLE "merchant_shipping_profiles";
