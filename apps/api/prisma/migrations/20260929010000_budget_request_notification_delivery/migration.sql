CREATE TABLE "budget_request_notification_deliveries" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "budget_request_id" TEXT NOT NULL REFERENCES "budget_requests" ("id") ON DELETE CASCADE,
  "channel" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lease_until" TIMESTAMP(3),
  "provider_message_id" TEXT,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "budget_request_notification_deliveries_channel"
  ON "budget_request_notification_deliveries" ("budget_request_id", "channel");
CREATE INDEX "budget_request_notification_deliveries_queue"
  ON "budget_request_notification_deliveries" ("status", "next_attempt_at", "lease_until");
