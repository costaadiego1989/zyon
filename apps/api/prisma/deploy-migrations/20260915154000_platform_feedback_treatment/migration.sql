CREATE TABLE "platform_feedback_treatments" (
    "feedback_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "priority" TEXT NOT NULL DEFAULT 'normal',
    "assigned_operator_id" TEXT,
    "first_read_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_feedback_treatments_pkey" PRIMARY KEY ("feedback_id")
);

CREATE TABLE "platform_feedback_notes" (
    "id" TEXT NOT NULL,
    "feedback_id" TEXT NOT NULL,
    "operator_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_feedback_notes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "platform_feedback_treatments_status_updated_at_idx" ON "platform_feedback_treatments"("status", "updated_at");
CREATE INDEX "platform_feedback_treatments_assigned_operator_id_updated_at_idx" ON "platform_feedback_treatments"("assigned_operator_id", "updated_at");
CREATE INDEX "platform_feedback_notes_feedback_id_created_at_idx" ON "platform_feedback_notes"("feedback_id", "created_at");
CREATE INDEX "platform_feedback_notes_operator_id_created_at_idx" ON "platform_feedback_notes"("operator_id", "created_at");

ALTER TABLE "platform_feedback_treatments" ADD CONSTRAINT "platform_feedback_treatments_feedback_id_fkey"
  FOREIGN KEY ("feedback_id") REFERENCES "merchant_platform_feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "platform_feedback_notes" ADD CONSTRAINT "platform_feedback_notes_feedback_id_fkey"
  FOREIGN KEY ("feedback_id") REFERENCES "platform_feedback_treatments"("feedback_id") ON DELETE CASCADE ON UPDATE CASCADE;
