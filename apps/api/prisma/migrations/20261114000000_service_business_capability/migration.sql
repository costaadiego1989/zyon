BEGIN;
-- CreateEnum
CREATE TYPE "MerchantBusinessMode" AS ENUM ('products', 'services');

-- CreateEnum
CREATE TYPE "ServicePaymentMode" AS ENUM ('online', 'at_attendance');

-- CreateEnum
CREATE TYPE "AvailabilityExceptionKind" AS ENUM ('one_off', 'block');

-- CreateEnum
CREATE TYPE "ServiceAppointmentOrigin" AS ENUM ('whatsapp', 'storefront', 'manual');

-- CreateEnum
CREATE TYPE "ServiceAppointmentStatus" AS ENUM ('pending', 'scheduled', 'in_service', 'completed', 'no_show', 'cancelled');

-- CreateEnum
CREATE TYPE "AppointmentPaymentStatus" AS ENUM ('pending', 'approved', 'failed', 'cancelled', 'refunded', 'partially_refunded');

-- CreateEnum
CREATE TYPE "WhatsAppAssistanceMode" AS ENUM ('ai', 'waiting_human', 'human');

-- CreateEnum
CREATE TYPE "PublicBusinessSourceType" AS ENUM ('company', 'professional', 'service', 'business_hours', 'faq', 'policy');

-- CreateEnum
CREATE TYPE "PublicSourcePublicationState" AS ENUM ('draft', 'published', 'withdrawn');

-- CreateEnum
CREATE TYPE "PublicSourceWorkStatus" AS ENUM ('pending', 'processing', 'completed', 'failed');

-- AlterTable
ALTER TABLE "merchants" ADD COLUMN     "business_mode" "MerchantBusinessMode" NOT NULL DEFAULT 'products',
ADD COLUMN     "business_mode_needs_review" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "business_mode_selected_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "service_reservations" ADD COLUMN     "appointment_id" TEXT,
ADD COLUMN     "classification_pending" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "service_business_policies" (
    "merchant_id" TEXT NOT NULL,
    "admissions_enabled" BOOLEAN NOT NULL DEFAULT false,
    "hold_enabled" BOOLEAN,
    "hold_minutes" INTEGER,
    "payment_mode" "ServicePaymentMode",
    "version" INTEGER NOT NULL DEFAULT 0,
    "configured_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_business_policies_pkey" PRIMARY KEY ("merchant_id")
);

-- CreateTable
CREATE TABLE "service_professionals" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "public_name" TEXT NOT NULL,
    "public_profile" JSONB NOT NULL DEFAULT '{}',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "time_zone" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_professionals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_services" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "professional_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "professional_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "professional_availability" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "professional_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "start_minute" INTEGER NOT NULL,
    "end_minute" INTEGER NOT NULL,
    "valid_from" TIMESTAMPTZ(3),
    "valid_until" TIMESTAMPTZ(3),
    "time_zone" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "professional_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "availability_exceptions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "professional_id" TEXT NOT NULL,
    "kind" "AvailabilityExceptionKind" NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "reason" TEXT,
    "actor_id" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "availability_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_appointments" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "professional_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "buyer_global_user_id" TEXT,
    "customer_snapshot" JSONB NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "time_zone" TEXT NOT NULL,
    "duration_minutes" INTEGER NOT NULL,
    "price_in_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "policy_snapshot" JSONB NOT NULL,
    "origin" "ServiceAppointmentOrigin" NOT NULL,
    "operational_status" "ServiceAppointmentStatus" NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "order_id" TEXT,
    "order_unit_id" TEXT,
    "availability_exception_id" TEXT,
    "confirmed_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "no_show_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_payments" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "mode" "ServicePaymentMode" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "status" "AppointmentPaymentStatus" NOT NULL DEFAULT 'pending',
    "payment_intent_id" TEXT,
    "provider" TEXT,
    "provider_payment_id" TEXT,
    "provider_evidence" JSONB,
    "received_at" TIMESTAMPTZ(3),
    "requires_regularization" BOOLEAN NOT NULL DEFAULT false,
    "regularization_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointment_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_receipts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "appointment_payment_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "payment_method" TEXT NOT NULL,
    "operator_id" TEXT NOT NULL,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_audits" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "command_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "actor_id" TEXT,
    "origin" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "appointment_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_handoff_bindings" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "config_id" TEXT NOT NULL,
    "whatsapp_session_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "ticket_id" TEXT,
    "mode" "WhatsAppAssistanceMode" NOT NULL DEFAULT 'ai',
    "epoch" INTEGER NOT NULL DEFAULT 0,
    "assigned_operator_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "whatsapp_handoff_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_source_work" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "source_type" "PublicBusinessSourceType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "source_version" TEXT NOT NULL,
    "source_hash" TEXT NOT NULL,
    "publication_state" "PublicSourcePublicationState" NOT NULL,
    "status" "PublicSourceWorkStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "lease_token" TEXT,
    "lease_expires_at" TIMESTAMPTZ(3),
    "last_error_code" TEXT,
    "indexed_at" TIMESTAMPTZ(3),
    "embedding_model" TEXT,
    "embedding_dimensions" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "public_source_work_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_professionals_merchant_id_is_active_is_published_id_idx" ON "service_professionals"("merchant_id", "is_active", "is_published", "id");

-- CreateIndex
CREATE UNIQUE INDEX "service_professionals_id_merchant_id_key" ON "service_professionals"("id", "merchant_id");

-- CreateIndex
CREATE INDEX "professional_services_merchant_id_product_id_is_active_idx" ON "professional_services"("merchant_id", "product_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "professional_services_id_merchant_id_key" ON "professional_services"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "professional_services_merchant_id_professional_id_product_i_key" ON "professional_services"("merchant_id", "professional_id", "product_id");

-- CreateIndex
CREATE INDEX "professional_availability_merchant_id_professional_id_is_ac_idx" ON "professional_availability"("merchant_id", "professional_id", "is_active", "weekday");

-- CreateIndex
CREATE UNIQUE INDEX "professional_availability_id_merchant_id_key" ON "professional_availability"("id", "merchant_id");

-- CreateIndex
CREATE INDEX "availability_exceptions_merchant_id_professional_id_is_acti_idx" ON "availability_exceptions"("merchant_id", "professional_id", "is_active", "starts_at", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "availability_exceptions_id_merchant_id_key" ON "availability_exceptions"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "availability_exceptions_id_professional_id_merchant_id_key" ON "availability_exceptions"("id", "professional_id", "merchant_id");

-- CreateIndex
CREATE INDEX "service_appointments_merchant_id_professional_id_operationa_idx" ON "service_appointments"("merchant_id", "professional_id", "operational_status", "starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "service_appointments_merchant_id_operational_status_starts__idx" ON "service_appointments"("merchant_id", "operational_status", "starts_at");

-- CreateIndex
CREATE INDEX "service_appointments_merchant_id_buyer_global_user_id_start_idx" ON "service_appointments"("merchant_id", "buyer_global_user_id", "starts_at");

-- CreateIndex
CREATE UNIQUE INDEX "service_appointments_id_merchant_id_key" ON "service_appointments"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "service_appointments_merchant_id_idempotency_key_key" ON "service_appointments"("merchant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "service_appointments_merchant_id_order_id_order_unit_id_key" ON "service_appointments"("merchant_id", "order_id", "order_unit_id");

-- CreateIndex
CREATE INDEX "appointment_payments_merchant_id_appointment_id_status_idx" ON "appointment_payments"("merchant_id", "appointment_id", "status");

-- CreateIndex
CREATE INDEX "appointment_payments_merchant_id_status_received_at_idx" ON "appointment_payments"("merchant_id", "status", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_payments_id_merchant_id_key" ON "appointment_payments"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_payments_merchant_id_idempotency_key_key" ON "appointment_payments"("merchant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_payments_merchant_id_appointment_id_payment_int_key" ON "appointment_payments"("merchant_id", "appointment_id", "payment_intent_id");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_payments_merchant_id_appointment_id_provider_pr_key" ON "appointment_payments"("merchant_id", "appointment_id", "provider", "provider_payment_id");

-- CreateIndex
CREATE INDEX "attendance_receipts_merchant_id_appointment_payment_id_idx" ON "attendance_receipts"("merchant_id", "appointment_payment_id");

-- CreateIndex
CREATE INDEX "attendance_receipts_merchant_id_received_at_idx" ON "attendance_receipts"("merchant_id", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_receipts_id_merchant_id_key" ON "attendance_receipts"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_receipts_merchant_id_idempotency_key_key" ON "attendance_receipts"("merchant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "appointment_audits_merchant_id_appointment_id_occurred_at_idx" ON "appointment_audits"("merchant_id", "appointment_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "appointment_audits_merchant_id_command_id_key" ON "appointment_audits"("merchant_id", "command_id");

-- CreateIndex
CREATE INDEX "whatsapp_handoff_bindings_merchant_id_config_id_mode_update_idx" ON "whatsapp_handoff_bindings"("merchant_id", "config_id", "mode", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_handoff_bindings_whatsapp_session_id_merchant_id_key" ON "whatsapp_handoff_bindings"("whatsapp_session_id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_handoff_bindings_merchant_id_ticket_id_key" ON "whatsapp_handoff_bindings"("merchant_id", "ticket_id");

-- CreateIndex
CREATE INDEX "public_source_work_merchant_id_source_type_source_id_create_idx" ON "public_source_work"("merchant_id", "source_type", "source_id", "created_at");

-- CreateIndex
CREATE INDEX "public_source_work_status_next_attempt_at_lease_expires_at_idx" ON "public_source_work"("status", "next_attempt_at", "lease_expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "public_source_work_merchant_id_source_type_source_id_source_key" ON "public_source_work"("merchant_id", "source_type", "source_id", "source_version");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_id_merchant_id_key" ON "support_tickets"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_id_merchant_id_key" ON "products"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_id_product_id_key" ON "product_variants"("id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_channel_configs_id_merchant_id_key" ON "whatsapp_channel_configs"("id", "merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_sessions_id_merchant_id_key" ON "whatsapp_sessions"("id", "merchant_id");

-- CreateIndex
CREATE INDEX "service_reservations_merchant_id_classification_pending_idx" ON "service_reservations"("merchant_id", "classification_pending");

-- CreateIndex
CREATE UNIQUE INDEX "service_reservations_merchant_id_appointment_id_key" ON "service_reservations"("merchant_id", "appointment_id");

-- AddForeignKey
ALTER TABLE "service_reservations" ADD CONSTRAINT "service_reservations_appointment_id_merchant_id_fkey" FOREIGN KEY ("appointment_id", "merchant_id") REFERENCES "service_appointments"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "service_business_policies" ADD CONSTRAINT "service_business_policies_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_professionals" ADD CONSTRAINT "service_professionals_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_professional_id_merchant_id_fkey" FOREIGN KEY ("professional_id", "merchant_id") REFERENCES "service_professionals"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_services_product_id_merchant_id_fkey" FOREIGN KEY ("product_id", "merchant_id") REFERENCES "products"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "professional_availability" ADD CONSTRAINT "professional_availability_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "professional_availability" ADD CONSTRAINT "professional_availability_professional_id_merchant_id_fkey" FOREIGN KEY ("professional_id", "merchant_id") REFERENCES "service_professionals"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "availability_exceptions" ADD CONSTRAINT "availability_exceptions_professional_id_merchant_id_fkey" FOREIGN KEY ("professional_id", "merchant_id") REFERENCES "service_professionals"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "service_appointments" ADD CONSTRAINT "service_appointments_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_appointments" ADD CONSTRAINT "service_appointments_professional_id_merchant_id_fkey" FOREIGN KEY ("professional_id", "merchant_id") REFERENCES "service_professionals"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "service_appointments" ADD CONSTRAINT "service_appointments_product_id_merchant_id_fkey" FOREIGN KEY ("product_id", "merchant_id") REFERENCES "products"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "service_appointments" ADD CONSTRAINT "service_appointments_variant_id_product_id_fkey" FOREIGN KEY ("variant_id", "product_id") REFERENCES "product_variants"("id", "product_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "service_appointments" ADD CONSTRAINT "service_appointments_merchant_id_professional_id_product_i_fkey" FOREIGN KEY ("merchant_id", "professional_id", "product_id") REFERENCES "professional_services"("merchant_id", "professional_id", "product_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "service_appointments" ADD CONSTRAINT "service_appointments_order_id_merchant_id_fkey" FOREIGN KEY ("order_id", "merchant_id") REFERENCES "completed_orders"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "service_appointments" ADD CONSTRAINT "service_appointments_availability_exception_id_professiona_fkey" FOREIGN KEY ("availability_exception_id", "professional_id", "merchant_id") REFERENCES "availability_exceptions"("id", "professional_id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointment_payments" ADD CONSTRAINT "appointment_payments_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_payments" ADD CONSTRAINT "appointment_payments_appointment_id_merchant_id_fkey" FOREIGN KEY ("appointment_id", "merchant_id") REFERENCES "service_appointments"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointment_payments" ADD CONSTRAINT "appointment_payments_payment_intent_id_merchant_id_fkey" FOREIGN KEY ("payment_intent_id", "merchant_id") REFERENCES "payment_intents"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "attendance_receipts" ADD CONSTRAINT "attendance_receipts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_receipts" ADD CONSTRAINT "attendance_receipts_appointment_payment_id_merchant_id_fkey" FOREIGN KEY ("appointment_payment_id", "merchant_id") REFERENCES "appointment_payments"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "appointment_audits" ADD CONSTRAINT "appointment_audits_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_audits" ADD CONSTRAINT "appointment_audits_appointment_id_merchant_id_fkey" FOREIGN KEY ("appointment_id", "merchant_id") REFERENCES "service_appointments"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "whatsapp_handoff_bindings" ADD CONSTRAINT "whatsapp_handoff_bindings_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_handoff_bindings" ADD CONSTRAINT "whatsapp_handoff_bindings_config_id_merchant_id_fkey" FOREIGN KEY ("config_id", "merchant_id") REFERENCES "whatsapp_channel_configs"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "whatsapp_handoff_bindings" ADD CONSTRAINT "whatsapp_handoff_bindings_whatsapp_session_id_merchant_id_fkey" FOREIGN KEY ("whatsapp_session_id", "merchant_id") REFERENCES "whatsapp_sessions"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "whatsapp_handoff_bindings" ADD CONSTRAINT "whatsapp_handoff_bindings_ticket_id_merchant_id_fkey" FOREIGN KEY ("ticket_id", "merchant_id") REFERENCES "support_tickets"("id", "merchant_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "public_source_work" ADD CONSTRAINT "public_source_work_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve explicit classification of legacy services without creating capacity
-- or choosing a financial policy on the merchant's behalf.
UPDATE "merchants" AS m SET "business_mode_needs_review" = true
WHERE EXISTS (SELECT 1 FROM "products" p WHERE p."merchant_id" = m."id" AND p."type" = 'service')
   OR EXISTS (SELECT 1 FROM "service_reservations" r WHERE r."merchant_id" = m."id");

ALTER TABLE "service_business_policies"
  ADD CONSTRAINT "service_policy_version" CHECK ("version" >= 0),
  ADD CONSTRAINT "service_policy_hold_duration" CHECK ("hold_minutes" IS NULL OR "hold_minutes" > 0),
  ADD CONSTRAINT "service_policy_configuration" CHECK ("configured_at" IS NULL OR
    ("version" > 0 AND "hold_enabled" IS NOT NULL AND "payment_mode" IS NOT NULL AND
      (NOT "hold_enabled" OR "hold_minutes" IS NOT NULL))),
  ADD CONSTRAINT "service_policy_admission" CHECK (NOT "admissions_enabled" OR "configured_at" IS NOT NULL);
ALTER TABLE "service_professionals" ADD CONSTRAINT "service_professional_version" CHECK ("version" > 0);
ALTER TABLE "professional_services" ADD CONSTRAINT "professional_service_version" CHECK ("version" > 0);
ALTER TABLE "professional_availability"
  ADD CONSTRAINT "professional_availability_window" CHECK ("weekday" BETWEEN 0 AND 6 AND "start_minute" >= 0 AND "start_minute" < "end_minute" AND "end_minute" <= 1440),
  ADD CONSTRAINT "professional_availability_validity" CHECK ("valid_from" IS NULL OR "valid_until" IS NULL OR "valid_from" < "valid_until"),
  ADD CONSTRAINT "professional_availability_version" CHECK ("version" > 0);
ALTER TABLE "availability_exceptions"
  ADD CONSTRAINT "availability_exception_interval" CHECK ("starts_at" < "ends_at"),
  ADD CONSTRAINT "availability_exception_version" CHECK ("version" > 0);
ALTER TABLE "service_appointments"
  ADD CONSTRAINT "service_appointment_interval" CHECK ("starts_at" < "ends_at"),
  ADD CONSTRAINT "service_appointment_duration" CHECK ("duration_minutes" BETWEEN 5 AND 480 AND "ends_at" - "starts_at" = make_interval(mins => "duration_minutes")),
  ADD CONSTRAINT "service_appointment_money" CHECK ("price_in_cents" >= 0 AND "currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "service_appointment_versions" CHECK ("version" > 0 AND "policy_version" > 0),
  ADD CONSTRAINT "service_appointment_command" CHECK (length("idempotency_key") > 0 AND length("request_fingerprint") > 0);
-- Confirmed capacity remains occupied after attendance, including no-show.
-- Cancellation releases capacity; a pending payment does not confirm capacity.
CREATE EXTENSION IF NOT EXISTS "btree_gist";
ALTER TABLE "service_appointments" ADD CONSTRAINT "service_appointment_no_overlap"
  EXCLUDE USING gist ("merchant_id" WITH =, "professional_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&)
  WHERE ("operational_status" IN ('scheduled', 'in_service', 'completed', 'no_show'));
ALTER TABLE "appointment_payments"
  ADD CONSTRAINT "appointment_payment_money" CHECK ("amount_cents" >= 0 AND "currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "appointment_payment_version" CHECK ("version" > 0);
ALTER TABLE "attendance_receipts"
  ADD CONSTRAINT "attendance_receipt_money" CHECK ("amount_cents" >= 0 AND "currency" ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT "attendance_receipt_actor" CHECK (length("operator_id") > 0 AND length("payment_method") > 0);
ALTER TABLE "appointment_audits" ADD CONSTRAINT "appointment_audit_version" CHECK ("version" > 0);
ALTER TABLE "whatsapp_handoff_bindings"
  ADD CONSTRAINT "whatsapp_handoff_epoch" CHECK ("epoch" >= 0),
  ADD CONSTRAINT "whatsapp_handoff_ticket" CHECK ("mode" = 'ai' OR "ticket_id" IS NOT NULL);
ALTER TABLE "public_source_work"
  ADD CONSTRAINT "public_source_identity" CHECK (length("source_id") > 0 AND length("source_version") > 0 AND length("source_hash") > 0),
  ADD CONSTRAINT "public_source_attempts" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "public_source_dimensions" CHECK ("embedding_dimensions" IS NULL OR "embedding_dimensions" > 0);
COMMIT;
