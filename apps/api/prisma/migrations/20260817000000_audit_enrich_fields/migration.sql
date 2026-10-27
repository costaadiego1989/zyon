-- AlterTable: Add audit enrichment fields
ALTER TABLE "merchant_audit_events" ADD COLUMN "ip_address" TEXT;
ALTER TABLE "merchant_audit_events" ADD COLUMN "user_agent" TEXT;
ALTER TABLE "merchant_audit_events" ADD COLUMN "outcome" TEXT DEFAULT 'success';
