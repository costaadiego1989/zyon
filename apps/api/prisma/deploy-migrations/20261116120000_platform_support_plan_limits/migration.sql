ALTER TABLE "platform_support_tickets" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'ticket' CHECK ("mode" IN ('ticket', 'realtime'));
CREATE TABLE "platform_support_monthly_usage" (
  "account_id" TEXT NOT NULL,
  "month" TEXT NOT NULL CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  "used" INTEGER NOT NULL DEFAULT 0 CHECK ("used" >= 0),
  PRIMARY KEY ("account_id", "month")
);
