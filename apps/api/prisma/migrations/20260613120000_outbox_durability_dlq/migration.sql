-- Durable outbox: add retry/backoff/DLQ bookkeeping columns (ADR 0003, ADR 0009 P0.4)
ALTER TABLE "outbox_messages" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "outbox_messages" ADD COLUMN "last_error" TEXT;
ALTER TABLE "outbox_messages" ADD COLUMN "next_attempt_at" TIMESTAMP(3);
ALTER TABLE "outbox_messages" ADD COLUMN "delivered_at" TIMESTAMP(3);

-- Dispatcher claim index: pending/retry rows ordered by next attempt time
CREATE INDEX "outbox_messages_status_next_attempt_at_idx" ON "outbox_messages"("status", "next_attempt_at");
