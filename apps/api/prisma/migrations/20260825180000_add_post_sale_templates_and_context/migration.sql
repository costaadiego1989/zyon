-- AlterTable
ALTER TABLE "whatsapp_sessions" ADD COLUMN "post_sale_context" JSONB;

-- CreateTable
CREATE TABLE "post_sale_message_templates" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "subject" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "post_sale_message_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "post_sale_message_templates_merchant_id_type_channel_key" ON "post_sale_message_templates"("merchant_id", "type", "channel");

-- CreateIndex
CREATE INDEX "post_sale_message_templates_merchant_id_idx" ON "post_sale_message_templates"("merchant_id");
