ALTER TABLE "outbox_messages"
  ADD COLUMN "lease_token" TEXT,
  ADD COLUMN "lease_expires_at" TIMESTAMP(3);

CREATE INDEX "outbox_messages_status_lease_expires_at_idx"
  ON "outbox_messages"("status", "lease_expires_at");
