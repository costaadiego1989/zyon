-- CreateTable
CREATE TABLE "support_tickets" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "session_id" TEXT,
  "buyer_message" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "resolved_at" TIMESTAMP(3),

  CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_tickets_merchant_id_status_created_at_idx"
  ON "support_tickets"("merchant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "support_tickets_merchant_id_session_id_idx"
  ON "support_tickets"("merchant_id", "session_id");
