-- AlterTable
ALTER TABLE "payment_intents" ADD COLUMN "commerce_order_id" TEXT;

-- CreateIndex
CREATE INDEX "payment_intents_merchant_id_commerce_order_id_idx" ON "payment_intents"("merchant_id", "commerce_order_id");
