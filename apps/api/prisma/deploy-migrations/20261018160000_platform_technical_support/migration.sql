CREATE TABLE "platform_support_tickets" (
  "id" TEXT PRIMARY KEY,
  "merchant_id" TEXT NOT NULL REFERENCES "merchants"("id") ON DELETE CASCADE,
  "author_user_id" TEXT NOT NULL,
  "client_request_id" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "category" TEXT NOT NULL CHECK ("category" IN ('bug','improvement','suggestion','other')),
  "status" TEXT NOT NULL DEFAULT 'open' CHECK ("status" IN ('open','in_progress','waiting_customer','resolved')),
  "severity" TEXT NOT NULL DEFAULT 'normal' CHECK ("severity" IN ('normal','high','critical')),
  "assigned_operator_id" TEXT REFERENCES "platform_operators"("id") ON DELETE SET NULL,
  "last_message_sequence" INTEGER NOT NULL DEFAULT 0 CHECK ("last_message_sequence" >= 0),
  "waiting_since" TIMESTAMP(3), "first_response_at" TIMESTAMP(3), "resolved_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "platform_support_tickets_request_key" UNIQUE ("merchant_id","author_user_id","client_request_id")
);
CREATE INDEX "platform_support_tickets_merchant_id_created_at_idx" ON "platform_support_tickets"("merchant_id","created_at");
CREATE INDEX "platform_support_tickets_status_severity_waiting_since_idx" ON "platform_support_tickets"("status","severity","waiting_since");
CREATE INDEX "platform_support_tickets_assigned_operator_id_status_idx" ON "platform_support_tickets"("assigned_operator_id","status");
CREATE TABLE "platform_support_messages" (
  "id" TEXT PRIMARY KEY, "ticket_id" TEXT NOT NULL REFERENCES "platform_support_tickets"("id") ON DELETE CASCADE,
  "sequence" INTEGER NOT NULL CHECK ("sequence" > 0), "author_key" TEXT NOT NULL,
  "sender" TEXT NOT NULL CHECK ("sender" IN ('merchant','operator')), "content" TEXT NOT NULL,
  "client_message_id" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_support_message_sequence_key" UNIQUE ("ticket_id","sequence"),
  CONSTRAINT "platform_support_message_request_key" UNIQUE ("ticket_id","author_key","client_message_id")
);
CREATE TABLE "platform_support_notes" (
  "id" TEXT PRIMARY KEY, "ticket_id" TEXT NOT NULL REFERENCES "platform_support_tickets"("id") ON DELETE CASCADE,
  "operator_id" TEXT NOT NULL REFERENCES "platform_operators"("id") ON DELETE RESTRICT,
  "content" TEXT NOT NULL, "client_request_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "platform_support_note_request_key" UNIQUE ("ticket_id","operator_id","client_request_id")
);
CREATE INDEX "platform_support_notes_ticket_id_created_at_idx" ON "platform_support_notes"("ticket_id","created_at");
CREATE TABLE "platform_support_reads" (
  "ticket_id" TEXT NOT NULL REFERENCES "platform_support_tickets"("id") ON DELETE CASCADE,
  "actor_key" TEXT NOT NULL, "sequence" INTEGER NOT NULL DEFAULT 0 CHECK ("sequence" >= 0),
  "updated_at" TIMESTAMP(3) NOT NULL, PRIMARY KEY ("ticket_id","actor_key")
);
