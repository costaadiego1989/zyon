ALTER TABLE "recovery_attempts"
  ADD COLUMN "last_buyer_activity_at" TIMESTAMP(3),
  ADD COLUMN "delivery_metadata" JSONB;

CREATE TABLE "recovery_follow_ups" (
  "id" TEXT NOT NULL,
  "merchant_id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "attempt_id" TEXT NOT NULL,
  "step" INTEGER NOT NULL,
  "due_at" TIMESTAMP(3) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "channel" TEXT,
  "provider_message_id" TEXT,
  "reason" TEXT,
  "fallback_reason" TEXT,
  "sent_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "recovery_follow_ups_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "recovery_follow_ups_step_check" CHECK ("step" IN (1, 2)),
  CONSTRAINT "recovery_follow_ups_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "recovery_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "recovery_follow_ups_attempt_id_step_key" ON "recovery_follow_ups"("attempt_id", "step");
CREATE INDEX "recovery_follow_ups_status_due_at_idx" ON "recovery_follow_ups"("status", "due_at");
CREATE INDEX "recovery_follow_ups_merchant_id_session_id_idx" ON "recovery_follow_ups"("merchant_id", "session_id");

-- Historical attempts deliberately receive no reminders. Only a new accepted
-- recovery with an observed activity anchor creates the two scheduled rows.
