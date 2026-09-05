-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MerchantPlan" AS ENUM ('STORE_ONLY', 'BOTH', 'API');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "StockReservationStatus" AS ENUM ('ACTIVE', 'CONFIRMED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'LABEL_GENERATED', 'SHIPPED', 'RECEIVED', 'INSPECTED_PASS', 'INSPECTED_FAIL', 'REFUND_PROCESSING', 'REFUND_COMPLETED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('DEFECTIVE', 'WRONG_ITEM', 'NOT_AS_DESCRIBED', 'CHANGED_MIND', 'DAMAGED_IN_TRANSIT', 'OTHER');

-- CreateEnum
CREATE TYPE "ItemCondition" AS ENUM ('NEW', 'GOOD', 'DAMAGED', 'UNUSABLE');

-- CreateEnum
CREATE TYPE "MerchantRole" AS ENUM ('OWNER', 'ADMIN', 'STAFF');

-- CreateEnum
CREATE TYPE "InviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "InventoryMovementKind" AS ENUM ('ENTRY', 'EXIT', 'ADJUSTMENT', 'RESERVATION', 'RELEASE', 'TRANSFER_IN', 'TRANSFER_OUT');

-- CreateTable
CREATE TABLE "merchants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "theme" JSONB,
    "store_category" TEXT,
    "store_settings" JSONB,
    "stripe_connect_account_id" TEXT,
    "crypto_payments_enabled" BOOLEAN NOT NULL DEFAULT false,
    "melhor_envio_access_token" TEXT,
    "melhor_envio_refresh_token" TEXT,
    "melhor_envio_expires_at" TIMESTAMP(3),
    "budget_mode_enabled" BOOLEAN NOT NULL DEFAULT false,
    "budget_email" TEXT,
    "budget_whatsapp" TEXT,
    "checkout_return_url" TEXT,
    "plan" "MerchantPlan" NOT NULL DEFAULT 'BOTH',
    "event_version" INTEGER NOT NULL DEFAULT 0,
    "shard_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_onboarding_states" (
    "merchant_id" TEXT NOT NULL,
    "steps" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_onboarding_states_pkey" PRIMARY KEY ("merchant_id")
);

-- CreateTable
CREATE TABLE "merchant_installations" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "widget_version" TEXT NOT NULL,
    "allowed_origins" TEXT[],
    "last_health_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_installations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_audit_events" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "correlation_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "outcome" TEXT DEFAULT 'success',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_commerce_connections" (
    "merchant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'shopify',
    "shop_domain" TEXT NOT NULL,
    "admin_token_cipher" TEXT NOT NULL,
    "api_version" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "last_tested_at" TIMESTAMP(3),
    "last_synced_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_commerce_connections_pkey" PRIMARY KEY ("merchant_id")
);

-- CreateTable
CREATE TABLE "merchant_payment_connections" (
    "merchant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "external_account_id" TEXT,
    "secret_cipher" TEXT,
    "wallet_id" TEXT,
    "charges_enabled" BOOLEAN NOT NULL DEFAULT false,
    "payouts_enabled" BOOLEAN NOT NULL DEFAULT false,
    "requirements" JSONB,
    "last_synced_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_payment_connections_pkey" PRIMARY KEY ("merchant_id","provider")
);

-- CreateTable
CREATE TABLE "merchant_billing_subscriptions" (
    "merchant_id" TEXT NOT NULL,
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "stripe_price_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'trialing',
    "trial_ends_at" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_billing_subscriptions_pkey" PRIMARY KEY ("merchant_id")
);

-- CreateTable
CREATE TABLE "commerce_pending_orders" (
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "commerce_order_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payment_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commerce_pending_orders_pkey" PRIMARY KEY ("merchant_id","session_id")
);

-- CreateTable
CREATE TABLE "commerce_paid_events" (
    "merchant_id" TEXT NOT NULL,
    "payment_reference" TEXT NOT NULL,
    "commerce_order_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commerce_paid_events_pkey" PRIMARY KEY ("merchant_id","payment_reference")
);

-- CreateTable
CREATE TABLE "merchant_users" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "role" TEXT NOT NULL,
    "oauth_provider" TEXT,
    "oauth_provider_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_rules" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "user_id" TEXT,
    "scope" TEXT NOT NULL,
    "identity" JSONB NOT NULL,
    "capabilities" JSONB NOT NULL,
    "guardrails" JSONB NOT NULL,
    "checkout_settings" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_settings" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "widget_behavior" JSONB NOT NULL,
    "intervention_policy" JSONB NOT NULL,
    "trigger_rules" JSONB NOT NULL,
    "suppression_rules" JSONB NOT NULL,
    "handoff" JSONB NOT NULL,
    "advanced_rules" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_sessions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "cart" JSONB NOT NULL,
    "customer" JSONB,
    "shipping" JSONB,
    "shipping_options" JSONB,
    "abandonment_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "trigger_agent" BOOLEAN NOT NULL DEFAULT false,
    "chat_history" JSONB NOT NULL DEFAULT '[]',
    "prompt_variant_id" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_events" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "event_name" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "checkout_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_identities" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "identity_key" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,

    CONSTRAINT "buyer_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_rules" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "max_discount_percent" DECIMAL(12,4) NOT NULL,
    "minimum_margin_percent" DECIMAL(12,4) NOT NULL,
    "allow_free_shipping" BOOLEAN NOT NULL,
    "allow_shipping_discount" BOOLEAN NOT NULL,
    "allow_bonus_item" BOOLEAN NOT NULL,
    "allow_stack_discount_and_free_shipping" BOOLEAN NOT NULL,
    "coupon_box_enabled" BOOLEAN NOT NULL,
    "free_shipping_min_cart_value" DECIMAL(12,4) NOT NULL,
    "max_shipping_subsidy" DECIMAL(12,4) NOT NULL,
    "max_partial_shipping_discount" DECIMAL(12,4) NOT NULL,
    "offer_expiration_minutes" INTEGER NOT NULL,
    "blocked_regions" TEXT[],
    "brand_voice" TEXT NOT NULL,
    "origin_zip" TEXT,
    "quick_replies" JSONB,
    "crypto_payments" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_settings" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "faq_items" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_settings_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "support_ticket_messages" (
    "id" TEXT NOT NULL,
    "ticket_id" TEXT NOT NULL,
    "sender_type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorized_offers" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DECIMAL(12,4) NOT NULL,
    "approved" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "margin_after_offer" DECIMAL(12,4) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "discount_code" TEXT,

    CONSTRAINT "authorized_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accepted_offers" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "offer_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" DECIMAL(12,4) NOT NULL,
    "margin_after_offer" DECIMAL(12,4) NOT NULL,
    "accepted_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accepted_offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "completed_orders" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "external_order_id" TEXT NOT NULL,
    "order_total" DECIMAL(12,4) NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'approved',
    "accepted_offer_id" TEXT,
    "tracking_code" TEXT,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,

    CONSTRAINT "completed_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_api_keys" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "environment" TEXT NOT NULL DEFAULT 'test',
    "allowed_cidrs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMP(3),
    "rotated_from_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),

    CONSTRAINT "merchant_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "http_idempotency_records" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_fingerprint" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'processing',
    "status_code" INTEGER,
    "response_body" JSONB,
    "response_headers" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "http_idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_webhook_endpoints" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "events" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "signing_secret" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_webhook_endpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_webhook_deliveries" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "endpoint_url" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "envelope" JSONB NOT NULL,
    "signing_secret" TEXT,
    "next_attempt_at" TIMESTAMP(3),
    "response_status" INTEGER,
    "response_body" TEXT,
    "error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "external_order_id" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "tracking_code" TEXT NOT NULL,
    "tracking_url" TEXT,
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "estimated_eta" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracking_events" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "shipment_id" TEXT NOT NULL,
    "tracking_code" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "location" TEXT,
    "carrier_raw" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tracking_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_purchase_records" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "global_user_id" TEXT,
    "merchant_customer_id" TEXT,
    "currency" TEXT NOT NULL,
    "total_amount" DECIMAL(12,4) NOT NULL,
    "discount_amount" DECIMAL(12,4) NOT NULL,
    "completed_at" TIMESTAMP(3) NOT NULL,
    "items" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_purchase_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_negotiation_policies" (
    "merchant_id" TEXT NOT NULL,
    "policy" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_negotiation_policies_pkey" PRIMARY KEY ("merchant_id")
);

-- CreateTable
CREATE TABLE "buyer_agent_negotiation_preferences" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "preferences" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_agent_negotiation_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "negotiation_sessions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "global_user_id" TEXT,
    "cart_fingerprint" TEXT NOT NULL,
    "result_json" JSONB NOT NULL,
    "estimated_ai_calls" INTEGER NOT NULL,
    "estimated_ai_cost_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "negotiation_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "negotiation_cost_ledger_entries" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "negotiation_session_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "ai_cost_cents" INTEGER,
    "discount_basis_points" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "negotiation_cost_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_agents" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "m2m_secret_hash" TEXT,
    "scopes" TEXT[] DEFAULT ARRAY['read', 'negotiate']::TEXT[],
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_reputations" (
    "id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "transaction_count" INTEGER NOT NULL DEFAULT 0,
    "dispute_count" INTEGER NOT NULL DEFAULT 0,
    "reputation_score" INTEGER NOT NULL DEFAULT 100,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_reputations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "m2m_protocol_configs" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "webhook_url" TEXT,
    "webhook_endpoint_id" TEXT,
    "max_session_ttl_minutes" INTEGER NOT NULL DEFAULT 30,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "m2m_protocol_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_messages" (
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "causation_id" TEXT NOT NULL,
    "producer" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_messages_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "outbox_handler_executions" (
    "event_id" TEXT NOT NULL,
    "handler_id" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_handler_executions_pkey" PRIMARY KEY ("event_id","handler_id")
);

-- CreateTable
CREATE TABLE "checkout_interventions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "checkout_interventions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shipping_quotes" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "destination_zip" TEXT NOT NULL,
    "quote_key" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "selected_carrier_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shipping_quotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_intents" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "approved_amount_cents" INTEGER,
    "accepted_offer_id" TEXT,
    "commerce_order_id" TEXT,
    "buyer_facing" JSONB,
    "status_history" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_intents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_provider_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'asaas',
    "merchant_id" TEXT,
    "event_id" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_provider_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_crypto_transfers" (
    "id" TEXT NOT NULL,
    "chain" TEXT NOT NULL,
    "tx_hash" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "intent_id" TEXT NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP + INTERVAL '5 minutes',

    CONSTRAINT "payment_crypto_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_accounts" (
    "global_user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "display_name" TEXT NOT NULL,
    "phone" TEXT,
    "cpf" TEXT,
    "address" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_accounts_pkey" PRIMARY KEY ("global_user_id")
);

-- CreateTable
CREATE TABLE "buyer_addresses" (
    "id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "zip" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "complement" TEXT,
    "neighborhood" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_conversations" (
    "id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "messages" JSONB NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buyer_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_preferences" (
    "id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "email_opt_in" BOOLEAN NOT NULL DEFAULT true,
    "sms_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "whatsapp_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "m2m_negotiation_enabled" BOOLEAN NOT NULL DEFAULT false,
    "language" TEXT NOT NULL DEFAULT 'pt-BR',
    "push_notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_agent_profiles" (
    "id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "personality" TEXT NOT NULL,
    "max_rounds" INTEGER NOT NULL,
    "target_discount_percent" DECIMAL(12,4) NOT NULL,
    "minimum_acceptable_discount_percent" DECIMAL(12,4) NOT NULL,
    "auto_accept_threshold" DECIMAL(12,4),
    "m2m_enabled" BOOLEAN NOT NULL DEFAULT false,
    "m2m_token_hash" TEXT,
    "m2m_token_created_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_agent_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_phone_otps" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "consumed_at" TIMESTAMP(3),
    "last_sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_phone_otps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webauthn_credentials" (
    "id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aaguid" TEXT NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000',
    "origin" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "webauthn_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempt_counters" (
    "id" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "window_ends_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "login_attempt_counters_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discount_type" TEXT NOT NULL,
    "discount_value" DECIMAL(12,4) NOT NULL,
    "min_cart_total" DECIMAL(12,4),
    "free_shipping_min_cart_total" DECIMAL(12,4),
    "max_usages" INTEGER,
    "min_per_buyer" INTEGER,
    "max_per_buyer" INTEGER,
    "usages_count" INTEGER NOT NULL DEFAULT 0,
    "allowed_skus" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blocked_skus" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowed_regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "blocked_regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" TEXT NOT NULL,
    "coupon_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "buyer_global_user_id" TEXT,
    "discount_applied" DECIMAL(12,4) NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'applied',
    "order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cross_sell_promotions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" JSONB NOT NULL,
    "recommended_skus" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "discount_percent" DECIMAL(12,4) NOT NULL,
    "max_discount_percent" DECIMAL(12,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cross_sell_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cross_sell_suggestions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "promo_id" TEXT NOT NULL,
    "ranked_items" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "agent_copy" TEXT NOT NULL,
    "computed_discount" DECIMAL(12,4) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "suggested_at" TIMESTAMP(3) NOT NULL,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "cross_sell_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_quote_jobs" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "buyer_global_user_id" TEXT,
    "raw_query" TEXT NOT NULL,
    "normalized_query" JSONB,
    "requested_sources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "results" JSONB NOT NULL DEFAULT '[]',
    "ranked_results" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "routing_decision" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_quote_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "self_checkout_buyer_users" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "consent_version" TEXT NOT NULL,
    "consent_updated_at" TIMESTAMP(3) NOT NULL,
    "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "self_checkout_buyer_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "self_checkout_wallets" (
    "id" TEXT NOT NULL,
    "buyer_user_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "self_checkout_wallets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "self_checkout_saved_addresses" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "zip_code" TEXT NOT NULL,
    "street" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "self_checkout_saved_addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "self_checkout_saved_payment_methods" (
    "id" TEXT NOT NULL,
    "wallet_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "gateway" TEXT NOT NULL,
    "gateway_token" TEXT NOT NULL,
    "last_four" TEXT NOT NULL,
    "brand" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "self_checkout_saved_payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "self_checkout_templates" (
    "id" TEXT NOT NULL,
    "buyer_user_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "saved_address_id" TEXT NOT NULL,
    "saved_payment_method_id" TEXT NOT NULL,
    "preferred_shipping_method_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "self_checkout_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_categories" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "parent_id" TEXT,
    "description" TEXT,
    "image_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'physical',
    "metadata" JSONB,
    "category_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "seo_title" TEXT,
    "meta_description" TEXT,
    "slug" TEXT,
    "og_title" TEXT,
    "og_description" TEXT,
    "twitter_card" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seo_generated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "attributes" JSONB NOT NULL DEFAULT '{}',
    "barcode" TEXT,
    "weight_grams" INTEGER,
    "length_cm" DOUBLE PRECISION,
    "width_cm" DOUBLE PRECISION,
    "height_cm" DOUBLE PRECISION,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_media" (
    "id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" "MediaType" NOT NULL DEFAULT 'IMAGE',
    "alt" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_prices" (
    "id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "base_price_in_cents" INTEGER NOT NULL,
    "cost_in_cents" INTEGER,
    "tax_percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_stock" (
    "id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "warehouse_id" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "cart_id" TEXT,
    "quantity" INTEGER NOT NULL,
    "status" "StockReservationStatus" NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_reviews" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_collections" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_products" (
    "id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "collection_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "returns" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "buyer_id" TEXT NOT NULL,
    "reason" "ReturnReason" NOT NULL,
    "notes" TEXT,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_items" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,

    CONSTRAINT "return_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_labels" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "tracking_number" TEXT NOT NULL,
    "label_url" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_labels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_inspections" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "inspected_by" TEXT NOT NULL,
    "item_condition" "ItemCondition" NOT NULL,
    "verdict" TEXT NOT NULL,
    "notes" TEXT,
    "inspected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "return_refunds" (
    "id" TEXT NOT NULL,
    "return_id" TEXT NOT NULL,
    "payment_intent_id" TEXT,
    "amount_in_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "return_refunds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_metrics_daily" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "conversations" INTEGER NOT NULL DEFAULT 0,
    "orders" INTEGER NOT NULL DEFAULT 0,
    "revenue_in_cents" INTEGER NOT NULL DEFAULT 0,
    "avg_order_value" INTEGER NOT NULL DEFAULT 0,
    "conversion_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "avg_session_duration_secs" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_metrics_daily_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "store_product_metrics" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "add_to_cart" INTEGER NOT NULL DEFAULT 0,
    "purchases" INTEGER NOT NULL DEFAULT 0,
    "revenue" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "store_product_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_search_vectors" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "embedding" TEXT,
    "content" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_search_vectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_team_members" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "MerchantRole" NOT NULL DEFAULT 'STAFF',
    "invited_by" TEXT,
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_team_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_invites" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "MerchantRole" NOT NULL DEFAULT 'STAFF',
    "status" "InviteStatus" NOT NULL DEFAULT 'PENDING',
    "invited_by" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_invites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "merchant_domains" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "cname_target" TEXT NOT NULL DEFAULT 'stores.zyon.com',
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "merchant_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storefront_carts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "items" JSONB NOT NULL DEFAULT '[]',
    "coupon_code" TEXT,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storefront_carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_promotions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "variant_id" TEXT,
    "category_id" TEXT,
    "discount_type" TEXT NOT NULL,
    "discount_value" INTEGER NOT NULL,
    "promo_price_in_cents" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_promotions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "story_categories" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "cover_image" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "story_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stories" (
    "id" TEXT NOT NULL,
    "category_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "image_url" TEXT NOT NULL,
    "title" TEXT,
    "title_config" JSONB,
    "duration" INTEGER NOT NULL DEFAULT 7,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_requests" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "customer_name" TEXT NOT NULL,
    "customer_email" TEXT NOT NULL,
    "customer_phone" TEXT NOT NULL,
    "items" JSONB NOT NULL,
    "subtotal" DOUBLE PRECISION NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_experiments" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "winner_variant_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_variants" (
    "id" TEXT NOT NULL,
    "experiment_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "is_control" BOOLEAN NOT NULL DEFAULT false,
    "system_prompt" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "prompt_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prompt_variant_results" (
    "id" TEXT NOT NULL,
    "variant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "converted" BOOLEAN NOT NULL,
    "revenue" DECIMAL(12,4),
    "offers_shown" INTEGER NOT NULL DEFAULT 0,
    "offers_accepted" INTEGER NOT NULL DEFAULT 0,
    "duration_seconds" INTEGER,
    "conversation_started" BOOLEAN NOT NULL DEFAULT true,
    "cart_viewed" BOOLEAN NOT NULL DEFAULT false,
    "cart_items_added" INTEGER NOT NULL DEFAULT 0,
    "checkout_started" BOOLEAN NOT NULL DEFAULT false,
    "checkout_completed" BOOLEAN NOT NULL DEFAULT false,
    "time_to_cart" INTEGER,
    "time_to_checkout" INTEGER,
    "time_to_conversion" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_variant_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_configs" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "commission_rate_bps" INTEGER NOT NULL DEFAULT 1500,
    "return_window_days" INTEGER NOT NULL DEFAULT 7,
    "payout_delay_days" INTEGER NOT NULL DEFAULT 14,
    "chargeback_window_days" INTEGER NOT NULL DEFAULT 30,
    "allowed_categories" TEXT[],
    "blocked_merchants" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_connections" (
    "id" TEXT NOT NULL,
    "buyer_merchant_id" TEXT NOT NULL,
    "seller_merchant_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketplace_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "federated_products" (
    "id" TEXT NOT NULL,
    "source_merchant_id" TEXT NOT NULL,
    "source_product_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT,
    "price_cents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "stock_available" BOOLEAN NOT NULL DEFAULT true,
    "image_url" TEXT,
    "searchable_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "federated_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cross_store_line_items" (
    "id" TEXT NOT NULL,
    "checkout_session_id" TEXT NOT NULL,
    "order_id" TEXT,
    "host_merchant_id" TEXT NOT NULL,
    "seller_merchant_id" TEXT NOT NULL,
    "federated_product_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_cents" INTEGER NOT NULL,
    "commission_rate_bps" INTEGER NOT NULL,
    "commission_cents" INTEGER NOT NULL,
    "seller_net_cents" INTEGER NOT NULL,
    "fulfillment_status" TEXT NOT NULL DEFAULT 'pending',
    "fulfillment_reference" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cross_store_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_settlements" (
    "id" TEXT NOT NULL,
    "host_merchant_id" TEXT NOT NULL,
    "seller_merchant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "line_item_id" TEXT NOT NULL,
    "total_amount_cents" INTEGER NOT NULL,
    "commission_cents" INTEGER NOT NULL,
    "seller_net_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'awaiting_return_window',
    "return_window_until" TIMESTAMP(3) NOT NULL,
    "transfer_scheduled_at" TIMESTAMP(3),
    "chargeback_window_until" TIMESTAMP(3) NOT NULL,
    "transferred_at" TIMESTAMP(3),
    "finalized_at" TIMESTAMP(3),
    "chargeback_at" TIMESTAMP(3),
    "return_at" TIMESTAMP(3),
    "provider_transfer_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "marketplace_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_seller_debts" (
    "id" TEXT NOT NULL,
    "seller_merchant_id" TEXT NOT NULL,
    "settlement_id" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'outstanding',
    "deducted_from_settlement_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "marketplace_seller_debts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_manager_observations" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "observation_window_start" TIMESTAMP(3) NOT NULL,
    "observation_window_end" TIMESTAMP(3) NOT NULL,
    "funnel_json" JSONB NOT NULL,
    "abandonment_json" JSONB NOT NULL,
    "objections_json" JSONB NOT NULL,
    "cross_sell_json" JSONB NOT NULL,
    "current_experiment_json" JSONB,
    "cohorts_json" JSONB NOT NULL,
    "revenue_json" JSONB NOT NULL,
    "ai_costs_cents" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_manager_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_manager_hypotheses" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "observation_id" TEXT NOT NULL,
    "hypothesis_text" TEXT NOT NULL,
    "reasoning" TEXT NOT NULL,
    "expected_lift_percent" DECIMAL(10,2) NOT NULL,
    "risk_level" TEXT NOT NULL,
    "template_json" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending_review',
    "approval_strategy" TEXT NOT NULL,
    "merchant_approved_at" TIMESTAMP(3),
    "merchant_approved_by" TEXT,
    "merchant_approval_reason" TEXT,
    "rejection_reason" TEXT,
    "created_experiment_id" TEXT,
    "experiment_creation_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "revenue_manager_hypotheses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_manager_strategy_lessons" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "experiment_id" TEXT NOT NULL,
    "hypothesis_id" TEXT NOT NULL,
    "hypothesis_text" TEXT NOT NULL,
    "actual_winner" TEXT NOT NULL,
    "hypothesis_was_correct" BOOLEAN NOT NULL,
    "control_conversion_rate" DECIMAL(10,4) NOT NULL,
    "challenger_conversion_rate" DECIMAL(10,4) NOT NULL,
    "conversion_lift_percent" DECIMAL(10,2) NOT NULL,
    "sessions_per_variant" INTEGER NOT NULL,
    "statistical_confidence" DECIMAL(10,4) NOT NULL,
    "insights_json" JSONB NOT NULL,
    "generator_feedback" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_manager_strategy_lessons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "protocol_sessions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "agent_id" TEXT NOT NULL,
    "current_state" TEXT NOT NULL,
    "state_history" JSONB NOT NULL,
    "session_data" JSONB NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "protocol_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recovery_attempts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "abandonment_reason" TEXT NOT NULL,
    "abandonment_score" DOUBLE PRECISION NOT NULL,
    "strategy_json" JSONB NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'in_session',
    "sent_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "recovered_at" TIMESTAMP(3),
    "recovered_order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recovery_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_intent_memory_consents" (
    "merchant_id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "opted_in" BOOLEAN NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_intent_memory_consents_pkey" PRIMARY KEY ("merchant_id","global_user_id")
);

-- CreateTable
CREATE TABLE "customer_intent_records" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "primary_intent" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "budget_tier" TEXT NOT NULL,
    "category_focus" TEXT[],
    "pain_points" TEXT[],
    "conversion_likelihood_pct" INTEGER NOT NULL,
    "behavioral_signals_json" JSONB NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_intent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holdout_group_assignments" (
    "global_user_id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "cohort" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "holdout_group_assignments_pkey" PRIMARY KEY ("global_user_id","merchant_id")
);

-- CreateTable
CREATE TABLE "attribution_tags" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "cohort" TEXT NOT NULL,
    "negotiation_applied" BOOLEAN NOT NULL DEFAULT false,
    "cross_sell_applied" BOOLEAN NOT NULL DEFAULT false,
    "progressive_discount_applied" BOOLEAN NOT NULL DEFAULT false,
    "cart_recovery_applied" BOOLEAN NOT NULL DEFAULT false,
    "intent_personalization_applied" BOOLEAN NOT NULL DEFAULT false,
    "experiment_variant_id" TEXT,
    "order_value_cents" INTEGER NOT NULL,
    "discount_given_cents" INTEGER NOT NULL DEFAULT 0,
    "shipping_subsidy_cents" INTEGER NOT NULL DEFAULT 0,
    "ai_cost_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attribution_tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "revenue_lift_snapshots" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "period_from" TIMESTAMP(3) NOT NULL,
    "period_to" TIMESTAMP(3) NOT NULL,
    "holdout_json" JSONB NOT NULL,
    "treatment_json" JSONB NOT NULL,
    "lift_json" JSONB NOT NULL,
    "breakout_json" JSONB NOT NULL,
    "confidence_json" JSONB NOT NULL,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revenue_lift_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "negotiation_attempts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "global_user_id" TEXT NOT NULL,
    "cart_fingerprint" TEXT NOT NULL,
    "negotiation_result_json" JSONB NOT NULL,
    "authorized_offer_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "negotiation_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_recovery_strategy_prefs" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "strategies" JSONB NOT NULL DEFAULT '{}',
    "config" JSONB DEFAULT '{"active_strategy":"offer_coupon"}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_recovery_strategy_prefs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_global_profiles" (
    "global_user_id" TEXT NOT NULL,
    "top_categories" TEXT[],
    "recent_skus" TEXT[],
    "preferred_brands" TEXT[],
    "avg_order_value_cents" INTEGER NOT NULL,
    "total_orders" INTEGER NOT NULL,
    "discount_sensitivity" TEXT NOT NULL,
    "last_purchase_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "buyer_global_profiles_pkey" PRIMARY KEY ("global_user_id")
);

-- CreateTable
CREATE TABLE "whatsapp_channel_configs" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" TEXT NOT NULL DEFAULT 'BUBBLEWHATS',
    "credentials" JSONB NOT NULL DEFAULT '{}',
    "whatsapp_number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "device_id" TEXT,
    "phone_number" TEXT,
    "webhook_secret" TEXT,
    "connected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_channel_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_sessions" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "buyer_phone" TEXT NOT NULL,
    "buyer_alias" TEXT,
    "checkout_session_id" TEXT,
    "device_id" TEXT NOT NULL,
    "current_options" JSONB NOT NULL DEFAULT '[]',
    "previous_options" JSONB NOT NULL DEFAULT '[]',
    "current_page" INTEGER NOT NULL DEFAULT 0,
    "last_activity_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_holds" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "payment_intent_id" TEXT NOT NULL,
    "order_id" TEXT,
    "total_amount_cents" INTEGER NOT NULL,
    "platform_fee_cents" INTEGER NOT NULL,
    "merchant_net_cents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'held',
    "hold_until" TIMESTAMP(3) NOT NULL,
    "released_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_locations" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'warehouse',
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "variant_name" TEXT,
    "location_id" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "reorder_point" INTEGER,
    "low_stock_threshold" INTEGER,
    "avg_cost_cents" INTEGER,
    "last_counted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_movements" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "kind" "InventoryMovementKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "external_ref" TEXT,
    "source" TEXT NOT NULL DEFAULT 'native',
    "actor_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_alerts" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMP(3),

    CONSTRAINT "inventory_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "erp_connections" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "direction_mode" TEXT NOT NULL DEFAULT 'erp_source_of_truth',
    "access_token_cipher" TEXT,
    "refresh_token_cipher" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "erp_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_connections" (
    "id" TEXT NOT NULL,
    "merchant_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "access_token_cipher" TEXT,
    "refresh_token_cipher" TEXT,
    "token_expires_at" TIMESTAMP(3),
    "last_sync_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "config" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_connections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchant_installations_merchant_id_environment_status_idx" ON "merchant_installations"("merchant_id", "environment", "status");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_installations_merchant_id_name_environment_key" ON "merchant_installations"("merchant_id", "name", "environment");

-- CreateIndex
CREATE INDEX "merchant_audit_events_merchant_id_occurred_at_id_idx" ON "merchant_audit_events"("merchant_id", "occurred_at", "id");

-- CreateIndex
CREATE INDEX "merchant_audit_events_merchant_id_resource_type_resource_id_idx" ON "merchant_audit_events"("merchant_id", "resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "merchant_commerce_connections_provider_status_idx" ON "merchant_commerce_connections"("provider", "status");

-- CreateIndex
CREATE INDEX "merchant_payment_connections_provider_status_idx" ON "merchant_payment_connections"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_billing_subscriptions_stripe_customer_id_key" ON "merchant_billing_subscriptions"("stripe_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_billing_subscriptions_stripe_subscription_id_key" ON "merchant_billing_subscriptions"("stripe_subscription_id");

-- CreateIndex
CREATE INDEX "merchant_billing_subscriptions_status_trial_ends_at_idx" ON "merchant_billing_subscriptions"("status", "trial_ends_at");

-- CreateIndex
CREATE INDEX "commerce_pending_orders_merchant_id_status_updated_at_idx" ON "commerce_pending_orders"("merchant_id", "status", "updated_at");

-- CreateIndex
CREATE INDEX "commerce_paid_events_merchant_id_created_at_idx" ON "commerce_paid_events"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "merchant_users_merchant_id_idx" ON "merchant_users"("merchant_id");

-- CreateIndex
CREATE INDEX "merchant_users_oauth_provider_oauth_provider_id_idx" ON "merchant_users"("oauth_provider", "oauth_provider_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_users_email_key" ON "merchant_users"("email");

-- CreateIndex
CREATE INDEX "agent_rules_merchant_id_user_id_idx" ON "agent_rules"("merchant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_rules_merchant_id_agent_id_key" ON "agent_rules"("merchant_id", "agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_rules_merchant_id_user_id_scope_key" ON "agent_rules"("merchant_id", "user_id", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_settings_merchant_id_key" ON "checkout_settings"("merchant_id");

-- CreateIndex
CREATE INDEX "checkout_settings_merchant_id_idx" ON "checkout_settings"("merchant_id");

-- CreateIndex
CREATE INDEX "checkout_sessions_merchant_id_updated_at_idx" ON "checkout_sessions"("merchant_id", "updated_at");

-- CreateIndex
CREATE INDEX "checkout_sessions_merchant_id_created_at_idx" ON "checkout_sessions"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "checkout_sessions_global_user_id_merchant_id_created_at_idx" ON "checkout_sessions"("global_user_id", "merchant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "checkout_sessions_merchant_id_session_id_key" ON "checkout_sessions"("merchant_id", "session_id");

-- CreateIndex
CREATE INDEX "checkout_events_merchant_id_session_id_occurred_at_idx" ON "checkout_events"("merchant_id", "session_id", "occurred_at");

-- CreateIndex
CREATE INDEX "buyer_identities_merchant_id_global_user_id_idx" ON "buyer_identities"("merchant_id", "global_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_identities_merchant_id_identity_key_key" ON "buyer_identities"("merchant_id", "identity_key");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_rules_merchant_id_key" ON "merchant_rules"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "support_settings_merchant_id_key" ON "support_settings"("merchant_id");

-- CreateIndex
CREATE INDEX "support_settings_merchant_id_idx" ON "support_settings"("merchant_id");

-- CreateIndex
CREATE INDEX "support_tickets_merchant_id_status_created_at_idx" ON "support_tickets"("merchant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "support_tickets_merchant_id_session_id_idx" ON "support_tickets"("merchant_id", "session_id");

-- CreateIndex
CREATE INDEX "support_ticket_messages_ticket_id_created_at_idx" ON "support_ticket_messages"("ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "authorized_offers_merchant_id_session_id_idx" ON "authorized_offers"("merchant_id", "session_id");

-- CreateIndex
CREATE INDEX "accepted_offers_merchant_id_accepted_at_idx" ON "accepted_offers"("merchant_id", "accepted_at");

-- CreateIndex
CREATE UNIQUE INDEX "accepted_offers_merchant_id_session_id_offer_id_key" ON "accepted_offers"("merchant_id", "session_id", "offer_id");

-- CreateIndex
CREATE INDEX "completed_orders_merchant_id_completed_at_idx" ON "completed_orders"("merchant_id", "completed_at");

-- CreateIndex
CREATE INDEX "completed_orders_merchant_id_status_completed_at_idx" ON "completed_orders"("merchant_id", "status", "completed_at");

-- CreateIndex
CREATE UNIQUE INDEX "completed_orders_merchant_id_session_id_external_order_id_key" ON "completed_orders"("merchant_id", "session_id", "external_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_api_keys_key_hash_key" ON "merchant_api_keys"("key_hash");

-- CreateIndex
CREATE INDEX "merchant_api_keys_merchant_id_environment_revoked_at_idx" ON "merchant_api_keys"("merchant_id", "environment", "revoked_at");

-- CreateIndex
CREATE INDEX "merchant_api_keys_merchant_id_expires_at_idx" ON "merchant_api_keys"("merchant_id", "expires_at");

-- CreateIndex
CREATE INDEX "http_idempotency_records_merchant_id_state_updated_at_idx" ON "http_idempotency_records"("merchant_id", "state", "updated_at");

-- CreateIndex
CREATE INDEX "http_idempotency_records_expires_at_idx" ON "http_idempotency_records"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "http_idempotency_records_merchant_id_idempotency_key_key" ON "http_idempotency_records"("merchant_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "merchant_webhook_endpoints_merchant_id_enabled_idx" ON "merchant_webhook_endpoints"("merchant_id", "enabled");

-- CreateIndex
CREATE INDEX "merchant_webhook_deliveries_merchant_id_status_next_attempt_idx" ON "merchant_webhook_deliveries"("merchant_id", "status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "merchant_webhook_deliveries_merchant_id_created_at_idx" ON "merchant_webhook_deliveries"("merchant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_webhook_deliveries_endpoint_id_event_id_key" ON "merchant_webhook_deliveries"("endpoint_id", "event_id");

-- CreateIndex
CREATE INDEX "shipments_merchant_id_status_updated_at_idx" ON "shipments"("merchant_id", "status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_merchant_id_external_order_id_key" ON "shipments"("merchant_id", "external_order_id");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_merchant_id_tracking_code_key" ON "shipments"("merchant_id", "tracking_code");

-- CreateIndex
CREATE INDEX "tracking_events_merchant_id_tracking_code_occurred_at_idx" ON "tracking_events"("merchant_id", "tracking_code", "occurred_at");

-- CreateIndex
CREATE INDEX "tracking_events_shipment_id_occurred_at_idx" ON "tracking_events"("shipment_id", "occurred_at");

-- CreateIndex
CREATE INDEX "buyer_purchase_records_merchant_id_global_user_id_idx" ON "buyer_purchase_records"("merchant_id", "global_user_id");

-- CreateIndex
CREATE INDEX "buyer_purchase_records_merchant_id_merchant_customer_id_idx" ON "buyer_purchase_records"("merchant_id", "merchant_customer_id");

-- CreateIndex
CREATE INDEX "buyer_purchase_records_merchant_id_completed_at_idx" ON "buyer_purchase_records"("merchant_id", "completed_at");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_purchase_records_merchant_id_order_id_key" ON "buyer_purchase_records"("merchant_id", "order_id");

-- CreateIndex
CREATE INDEX "buyer_agent_negotiation_preferences_merchant_id_idx" ON "buyer_agent_negotiation_preferences"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_agent_negotiation_preferences_merchant_id_global_user_key" ON "buyer_agent_negotiation_preferences"("merchant_id", "global_user_id");

-- CreateIndex
CREATE INDEX "negotiation_sessions_merchant_id_created_at_idx" ON "negotiation_sessions"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "negotiation_cost_ledger_entries_merchant_id_negotiation_ses_idx" ON "negotiation_cost_ledger_entries"("merchant_id", "negotiation_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "negotiation_cost_ledger_entries_negotiation_session_id_even_key" ON "negotiation_cost_ledger_entries"("negotiation_session_id", "event_type");

-- CreateIndex
CREATE INDEX "buyer_agents_merchant_id_status_idx" ON "buyer_agents"("merchant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_agents_merchant_id_global_user_id_key" ON "buyer_agents"("merchant_id", "global_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "agent_reputations_agent_id_key" ON "agent_reputations"("agent_id");

-- CreateIndex
CREATE UNIQUE INDEX "m2m_protocol_configs_merchant_id_key" ON "m2m_protocol_configs"("merchant_id");

-- CreateIndex
CREATE INDEX "outbox_messages_merchant_id_created_at_idx" ON "outbox_messages"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "outbox_messages_status_created_at_idx" ON "outbox_messages"("status", "created_at");

-- CreateIndex
CREATE INDEX "outbox_messages_status_next_attempt_at_idx" ON "outbox_messages"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "outbox_handler_executions_event_id_idx" ON "outbox_handler_executions"("event_id");

-- CreateIndex
CREATE INDEX "checkout_interventions_merchant_id_session_id_occurred_at_idx" ON "checkout_interventions"("merchant_id", "session_id", "occurred_at");

-- CreateIndex
CREATE INDEX "shipping_quotes_merchant_id_session_id_created_at_idx" ON "shipping_quotes"("merchant_id", "session_id", "created_at");

-- CreateIndex
CREATE INDEX "shipping_quotes_merchant_id_quote_key_expires_at_idx" ON "shipping_quotes"("merchant_id", "quote_key", "expires_at");

-- CreateIndex
CREATE INDEX "payment_intents_merchant_id_session_id_idx" ON "payment_intents"("merchant_id", "session_id");

-- CreateIndex
CREATE INDEX "payment_intents_merchant_id_commerce_order_id_idx" ON "payment_intents"("merchant_id", "commerce_order_id");

-- CreateIndex
CREATE INDEX "payment_intents_status_updated_at_idx" ON "payment_intents"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_merchant_id_session_id_idempotency_key_key" ON "payment_intents"("merchant_id", "session_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "payment_intents_merchant_id_provider_payment_id_key" ON "payment_intents"("merchant_id", "provider_payment_id");

-- CreateIndex
CREATE INDEX "payment_provider_events_merchant_id_processed_at_idx" ON "payment_provider_events"("merchant_id", "processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_provider_events_provider_merchant_id_event_id_key" ON "payment_provider_events"("provider", "merchant_id", "event_id");

-- CreateIndex
CREATE INDEX "payment_crypto_transfers_merchant_id_intent_id_idx" ON "payment_crypto_transfers"("merchant_id", "intent_id");

-- CreateIndex
CREATE INDEX "payment_crypto_transfers_expires_at_idx" ON "payment_crypto_transfers"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_crypto_transfers_chain_tx_hash_key" ON "payment_crypto_transfers"("chain", "tx_hash");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_accounts_email_key" ON "buyer_accounts"("email");

-- CreateIndex
CREATE INDEX "buyer_addresses_global_user_id_idx" ON "buyer_addresses"("global_user_id");

-- CreateIndex
CREATE INDEX "buyer_conversations_global_user_id_last_message_at_idx" ON "buyer_conversations"("global_user_id", "last_message_at");

-- CreateIndex
CREATE INDEX "buyer_conversations_merchant_id_session_id_idx" ON "buyer_conversations"("merchant_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_preferences_global_user_id_key" ON "buyer_preferences"("global_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_agent_profiles_global_user_id_key" ON "buyer_agent_profiles"("global_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "buyer_phone_otps_phone_key" ON "buyer_phone_otps"("phone");

-- CreateIndex
CREATE INDEX "buyer_phone_otps_expires_at_idx" ON "buyer_phone_otps"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "webauthn_credentials_credential_id_key" ON "webauthn_credentials"("credential_id");

-- CreateIndex
CREATE INDEX "webauthn_credentials_global_user_id_idx" ON "webauthn_credentials"("global_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "login_attempt_counters_scope_key_key" ON "login_attempt_counters"("scope_key");

-- CreateIndex
CREATE INDEX "login_attempt_counters_window_ends_at_idx" ON "login_attempt_counters"("window_ends_at");

-- CreateIndex
CREATE INDEX "coupons_merchant_id_status_idx" ON "coupons"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "coupons_ends_at_idx" ON "coupons"("ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "coupons_merchant_id_code_key" ON "coupons"("merchant_id", "code");

-- CreateIndex
CREATE INDEX "coupon_redemptions_merchant_id_coupon_id_status_idx" ON "coupon_redemptions"("merchant_id", "coupon_id", "status");

-- CreateIndex
CREATE INDEX "coupon_redemptions_merchant_id_buyer_global_user_id_coupon__idx" ON "coupon_redemptions"("merchant_id", "buyer_global_user_id", "coupon_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_merchant_id_session_id_coupon_id_key" ON "coupon_redemptions"("merchant_id", "session_id", "coupon_id");

-- CreateIndex
CREATE INDEX "cross_sell_promotions_merchant_id_status_idx" ON "cross_sell_promotions"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "cross_sell_suggestions_merchant_id_session_id_promo_id_stat_idx" ON "cross_sell_suggestions"("merchant_id", "session_id", "promo_id", "status");

-- CreateIndex
CREATE INDEX "cross_sell_suggestions_merchant_id_status_idx" ON "cross_sell_suggestions"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "price_quote_jobs_merchant_id_status_created_at_idx" ON "price_quote_jobs"("merchant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "price_quote_jobs_merchant_id_session_id_idx" ON "price_quote_jobs"("merchant_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "self_checkout_buyer_users_merchant_id_email_key" ON "self_checkout_buyer_users"("merchant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "self_checkout_wallets_buyer_user_id_key" ON "self_checkout_wallets"("buyer_user_id");

-- CreateIndex
CREATE INDEX "self_checkout_saved_addresses_wallet_id_idx" ON "self_checkout_saved_addresses"("wallet_id");

-- CreateIndex
CREATE INDEX "self_checkout_saved_payment_methods_wallet_id_idx" ON "self_checkout_saved_payment_methods"("wallet_id");

-- CreateIndex
CREATE INDEX "self_checkout_templates_buyer_user_id_idx" ON "self_checkout_templates"("buyer_user_id");

-- CreateIndex
CREATE INDEX "self_checkout_templates_merchant_id_buyer_user_id_idx" ON "self_checkout_templates"("merchant_id", "buyer_user_id");

-- CreateIndex
CREATE INDEX "product_categories_merchant_id_idx" ON "product_categories"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_categories_merchant_id_slug_key" ON "product_categories"("merchant_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
CREATE INDEX "products_merchant_id_idx" ON "products"("merchant_id");

-- CreateIndex
CREATE INDEX "products_merchant_id_is_active_created_at_idx" ON "products"("merchant_id", "is_active", "created_at");

-- CreateIndex
CREATE INDEX "products_merchant_id_category_id_is_active_idx" ON "products"("merchant_id", "category_id", "is_active");

-- CreateIndex
CREATE INDEX "products_slug_idx" ON "products"("slug");

-- CreateIndex
CREATE INDEX "product_variants_product_id_idx" ON "product_variants"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_product_id_sku_key" ON "product_variants"("product_id", "sku");

-- CreateIndex
CREATE INDEX "product_media_variant_id_idx" ON "product_media"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_prices_variant_id_key" ON "product_prices"("variant_id");

-- CreateIndex
CREATE INDEX "product_stock_variant_id_idx" ON "product_stock"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_stock_variant_id_warehouse_id_key" ON "product_stock"("variant_id", "warehouse_id");

-- CreateIndex
CREATE INDEX "stock_reservations_variant_id_status_idx" ON "stock_reservations"("variant_id", "status");

-- CreateIndex
CREATE INDEX "stock_reservations_expires_at_status_idx" ON "stock_reservations"("expires_at", "status");

-- CreateIndex
CREATE INDEX "product_reviews_product_id_approved_idx" ON "product_reviews"("product_id", "approved");

-- CreateIndex
CREATE INDEX "product_reviews_buyer_id_idx" ON "product_reviews"("buyer_id");

-- CreateIndex
CREATE INDEX "product_collections_merchant_id_idx" ON "product_collections"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "collection_products_collection_id_product_id_key" ON "collection_products"("collection_id", "product_id");

-- CreateIndex
CREATE INDEX "returns_merchant_id_status_idx" ON "returns"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "returns_merchant_id_created_at_idx" ON "returns"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "returns_order_id_idx" ON "returns"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_labels_return_id_key" ON "return_labels"("return_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_inspections_return_id_key" ON "return_inspections"("return_id");

-- CreateIndex
CREATE UNIQUE INDEX "return_refunds_return_id_key" ON "return_refunds"("return_id");

-- CreateIndex
CREATE INDEX "store_metrics_daily_merchant_id_date_idx" ON "store_metrics_daily"("merchant_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "store_metrics_daily_merchant_id_date_key" ON "store_metrics_daily"("merchant_id", "date");

-- CreateIndex
CREATE INDEX "store_product_metrics_merchant_id_month_idx" ON "store_product_metrics"("merchant_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "store_product_metrics_merchant_id_product_id_month_key" ON "store_product_metrics"("merchant_id", "product_id", "month");

-- CreateIndex
CREATE UNIQUE INDEX "product_search_vectors_product_id_key" ON "product_search_vectors"("product_id");

-- CreateIndex
CREATE INDEX "product_search_vectors_merchant_id_idx" ON "product_search_vectors"("merchant_id");

-- CreateIndex
CREATE INDEX "merchant_team_members_merchant_id_idx" ON "merchant_team_members"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_team_members_merchant_id_user_id_key" ON "merchant_team_members"("merchant_id", "user_id");

-- CreateIndex
CREATE INDEX "merchant_invites_merchant_id_idx" ON "merchant_invites"("merchant_id");

-- CreateIndex
CREATE INDEX "merchant_invites_email_status_idx" ON "merchant_invites"("email", "status");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_domains_domain_key" ON "merchant_domains"("domain");

-- CreateIndex
CREATE INDEX "merchant_domains_merchant_id_idx" ON "merchant_domains"("merchant_id");

-- CreateIndex
CREATE INDEX "storefront_carts_expires_at_idx" ON "storefront_carts"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "storefront_carts_merchant_id_session_id_key" ON "storefront_carts"("merchant_id", "session_id");

-- CreateIndex
CREATE INDEX "product_promotions_merchant_id_is_active_ends_at_idx" ON "product_promotions"("merchant_id", "is_active", "ends_at");

-- CreateIndex
CREATE INDEX "product_promotions_variant_id_is_active_idx" ON "product_promotions"("variant_id", "is_active");

-- CreateIndex
CREATE INDEX "product_promotions_category_id_is_active_idx" ON "product_promotions"("category_id", "is_active");

-- CreateIndex
CREATE INDEX "story_categories_merchant_id_is_archived_idx" ON "story_categories"("merchant_id", "is_archived");

-- CreateIndex
CREATE INDEX "stories_category_id_is_archived_idx" ON "stories"("category_id", "is_archived");

-- CreateIndex
CREATE INDEX "stories_merchant_id_idx" ON "stories"("merchant_id");

-- CreateIndex
CREATE INDEX "budget_requests_merchant_id_created_at_idx" ON "budget_requests"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "budget_requests_merchant_id_status_idx" ON "budget_requests"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "prompt_experiments_merchant_id_status_idx" ON "prompt_experiments"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "prompt_experiments_merchant_id_created_at_idx" ON "prompt_experiments"("merchant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_experiments_merchant_id_name_key" ON "prompt_experiments"("merchant_id", "name");

-- CreateIndex
CREATE INDEX "prompt_variants_experiment_id_idx" ON "prompt_variants"("experiment_id");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_variants_experiment_id_name_key" ON "prompt_variants"("experiment_id", "name");

-- CreateIndex
CREATE INDEX "prompt_variant_results_variant_id_created_at_idx" ON "prompt_variant_results"("variant_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_prompt_variant_results_funnel" ON "prompt_variant_results"("variant_id", "checkout_completed", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_variant_results_variant_id_session_id_key" ON "prompt_variant_results"("variant_id", "session_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_configs_merchant_id_key" ON "marketplace_configs"("merchant_id");

-- CreateIndex
CREATE INDEX "marketplace_connections_buyer_merchant_id_status_idx" ON "marketplace_connections"("buyer_merchant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "marketplace_connections_buyer_merchant_id_seller_merchant_i_key" ON "marketplace_connections"("buyer_merchant_id", "seller_merchant_id");

-- CreateIndex
CREATE INDEX "federated_products_category_idx" ON "federated_products"("category");

-- CreateIndex
CREATE INDEX "federated_products_source_merchant_id_idx" ON "federated_products"("source_merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "federated_products_source_merchant_id_source_product_id_key" ON "federated_products"("source_merchant_id", "source_product_id");

-- CreateIndex
CREATE INDEX "cross_store_line_items_host_merchant_id_idx" ON "cross_store_line_items"("host_merchant_id");

-- CreateIndex
CREATE INDEX "cross_store_line_items_seller_merchant_id_idx" ON "cross_store_line_items"("seller_merchant_id");

-- CreateIndex
CREATE INDEX "cross_store_line_items_order_id_idx" ON "cross_store_line_items"("order_id");

-- CreateIndex
CREATE INDEX "marketplace_settlements_host_merchant_id_idx" ON "marketplace_settlements"("host_merchant_id");

-- CreateIndex
CREATE INDEX "marketplace_settlements_seller_merchant_id_idx" ON "marketplace_settlements"("seller_merchant_id");

-- CreateIndex
CREATE INDEX "marketplace_settlements_status_idx" ON "marketplace_settlements"("status");

-- CreateIndex
CREATE INDEX "marketplace_settlements_transfer_scheduled_at_idx" ON "marketplace_settlements"("transfer_scheduled_at");

-- CreateIndex
CREATE INDEX "marketplace_seller_debts_seller_merchant_id_idx" ON "marketplace_seller_debts"("seller_merchant_id");

-- CreateIndex
CREATE INDEX "marketplace_seller_debts_status_idx" ON "marketplace_seller_debts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "revenue_manager_observations_fingerprint_key" ON "revenue_manager_observations"("fingerprint");

-- CreateIndex
CREATE INDEX "revenue_manager_observations_merchant_id_created_at_idx" ON "revenue_manager_observations"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "revenue_manager_observations_merchant_id_observation_window_idx" ON "revenue_manager_observations"("merchant_id", "observation_window_start");

-- CreateIndex
CREATE INDEX "revenue_manager_hypotheses_merchant_id_status_idx" ON "revenue_manager_hypotheses"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "revenue_manager_hypotheses_merchant_id_created_at_idx" ON "revenue_manager_hypotheses"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "revenue_manager_strategy_lessons_merchant_id_recorded_at_idx" ON "revenue_manager_strategy_lessons"("merchant_id", "recorded_at");

-- CreateIndex
CREATE INDEX "revenue_manager_strategy_lessons_experiment_id_idx" ON "revenue_manager_strategy_lessons"("experiment_id");

-- CreateIndex
CREATE INDEX "protocol_sessions_merchant_id_expires_at_idx" ON "protocol_sessions"("merchant_id", "expires_at");

-- CreateIndex
CREATE INDEX "protocol_sessions_merchant_id_current_state_idx" ON "protocol_sessions"("merchant_id", "current_state");

-- CreateIndex
CREATE INDEX "recovery_attempts_merchant_id_status_idx" ON "recovery_attempts"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "recovery_attempts_merchant_id_created_at_idx" ON "recovery_attempts"("merchant_id", "created_at");

-- CreateIndex
CREATE INDEX "recovery_attempts_session_id_idx" ON "recovery_attempts"("session_id");

-- CreateIndex
CREATE INDEX "customer_intent_records_merchant_id_global_user_id_idx" ON "customer_intent_records"("merchant_id", "global_user_id");

-- CreateIndex
CREATE INDEX "customer_intent_records_merchant_id_generated_at_idx" ON "customer_intent_records"("merchant_id", "generated_at");

-- CreateIndex
CREATE INDEX "holdout_group_assignments_merchant_id_cohort_idx" ON "holdout_group_assignments"("merchant_id", "cohort");

-- CreateIndex
CREATE INDEX "attribution_tags_merchant_id_cohort_created_at_idx" ON "attribution_tags"("merchant_id", "cohort", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "attribution_tags_merchant_id_order_id_key" ON "attribution_tags"("merchant_id", "order_id");

-- CreateIndex
CREATE INDEX "revenue_lift_snapshots_merchant_id_calculated_at_idx" ON "revenue_lift_snapshots"("merchant_id", "calculated_at");

-- CreateIndex
CREATE INDEX "negotiation_attempts_merchant_id_session_id_idx" ON "negotiation_attempts"("merchant_id", "session_id");

-- CreateIndex
CREATE INDEX "negotiation_attempts_cart_fingerprint_created_at_idx" ON "negotiation_attempts"("cart_fingerprint", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "cart_recovery_strategy_prefs_merchant_id_key" ON "cart_recovery_strategy_prefs"("merchant_id");

-- CreateIndex
CREATE INDEX "cart_recovery_strategy_prefs_merchant_id_idx" ON "cart_recovery_strategy_prefs"("merchant_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_channel_configs_merchant_id_key" ON "whatsapp_channel_configs"("merchant_id");

-- CreateIndex
CREATE INDEX "whatsapp_channel_configs_whatsapp_number_idx" ON "whatsapp_channel_configs"("whatsapp_number");

-- CreateIndex
CREATE INDEX "whatsapp_channel_configs_device_id_idx" ON "whatsapp_channel_configs"("device_id");

-- CreateIndex
CREATE INDEX "whatsapp_sessions_merchant_id_status_idx" ON "whatsapp_sessions"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "whatsapp_sessions_last_activity_at_idx" ON "whatsapp_sessions"("last_activity_at");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_sessions_merchant_id_buyer_phone_device_id_key" ON "whatsapp_sessions"("merchant_id", "buyer_phone", "device_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_holds_payment_intent_id_key" ON "payment_holds"("payment_intent_id");

-- CreateIndex
CREATE INDEX "payment_holds_merchant_id_status_idx" ON "payment_holds"("merchant_id", "status");

-- CreateIndex
CREATE INDEX "payment_holds_status_hold_until_idx" ON "payment_holds"("status", "hold_until");

-- CreateIndex
CREATE INDEX "inventory_locations_merchant_id_is_active_idx" ON "inventory_locations"("merchant_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_locations_merchant_id_name_key" ON "inventory_locations"("merchant_id", "name");

-- CreateIndex
CREATE INDEX "inventory_items_merchant_id_location_id_idx" ON "inventory_items"("merchant_id", "location_id");

-- CreateIndex
CREATE INDEX "inventory_items_merchant_id_sku_idx" ON "inventory_items"("merchant_id", "sku");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_items_merchant_id_sku_location_id_key" ON "inventory_items"("merchant_id", "sku", "location_id");

-- CreateIndex
CREATE INDEX "inventory_movements_merchant_id_item_id_created_at_idx" ON "inventory_movements"("merchant_id", "item_id", "created_at");

-- CreateIndex
CREATE INDEX "inventory_movements_merchant_id_kind_created_at_idx" ON "inventory_movements"("merchant_id", "kind", "created_at");

-- CreateIndex
CREATE INDEX "inventory_alerts_merchant_id_acknowledged_created_at_idx" ON "inventory_alerts"("merchant_id", "acknowledged", "created_at");

-- CreateIndex
CREATE INDEX "erp_connections_merchant_id_status_idx" ON "erp_connections"("merchant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "erp_connections_merchant_id_provider_key" ON "erp_connections"("merchant_id", "provider");

-- CreateIndex
CREATE INDEX "crm_connections_merchant_id_status_idx" ON "crm_connections"("merchant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "crm_connections_merchant_id_provider_key" ON "crm_connections"("merchant_id", "provider");

-- AddForeignKey
ALTER TABLE "merchant_onboarding_states" ADD CONSTRAINT "merchant_onboarding_states_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_installations" ADD CONSTRAINT "merchant_installations_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_audit_events" ADD CONSTRAINT "merchant_audit_events_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_commerce_connections" ADD CONSTRAINT "merchant_commerce_connections_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_payment_connections" ADD CONSTRAINT "merchant_payment_connections_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_billing_subscriptions" ADD CONSTRAINT "merchant_billing_subscriptions_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_pending_orders" ADD CONSTRAINT "commerce_pending_orders_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commerce_paid_events" ADD CONSTRAINT "commerce_paid_events_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_users" ADD CONSTRAINT "merchant_users_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_rules" ADD CONSTRAINT "agent_rules_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "merchant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_events" ADD CONSTRAINT "checkout_events_merchant_id_session_id_fkey" FOREIGN KEY ("merchant_id", "session_id") REFERENCES "checkout_sessions"("merchant_id", "session_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorized_offers" ADD CONSTRAINT "authorized_offers_merchant_id_session_id_fkey" FOREIGN KEY ("merchant_id", "session_id") REFERENCES "checkout_sessions"("merchant_id", "session_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accepted_offers" ADD CONSTRAINT "accepted_offers_merchant_id_session_id_fkey" FOREIGN KEY ("merchant_id", "session_id") REFERENCES "checkout_sessions"("merchant_id", "session_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accepted_offers" ADD CONSTRAINT "accepted_offers_offer_id_fkey" FOREIGN KEY ("offer_id") REFERENCES "authorized_offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "completed_orders" ADD CONSTRAINT "completed_orders_merchant_id_session_id_fkey" FOREIGN KEY ("merchant_id", "session_id") REFERENCES "checkout_sessions"("merchant_id", "session_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_api_keys" ADD CONSTRAINT "merchant_api_keys_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "http_idempotency_records" ADD CONSTRAINT "http_idempotency_records_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_webhook_endpoints" ADD CONSTRAINT "merchant_webhook_endpoints_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_webhook_deliveries" ADD CONSTRAINT "merchant_webhook_deliveries_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_webhook_deliveries" ADD CONSTRAINT "merchant_webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "merchant_webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracking_events" ADD CONSTRAINT "tracking_events_shipment_id_fkey" FOREIGN KEY ("shipment_id") REFERENCES "shipments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "negotiation_cost_ledger_entries" ADD CONSTRAINT "negotiation_cost_ledger_entries_negotiation_session_id_fkey" FOREIGN KEY ("negotiation_session_id") REFERENCES "negotiation_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_reputations" ADD CONSTRAINT "agent_reputations_agent_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "buyer_agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_addresses" ADD CONSTRAINT "buyer_addresses_global_user_id_fkey" FOREIGN KEY ("global_user_id") REFERENCES "buyer_accounts"("global_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_conversations" ADD CONSTRAINT "buyer_conversations_global_user_id_fkey" FOREIGN KEY ("global_user_id") REFERENCES "buyer_accounts"("global_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_preferences" ADD CONSTRAINT "buyer_preferences_global_user_id_fkey" FOREIGN KEY ("global_user_id") REFERENCES "buyer_accounts"("global_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buyer_agent_profiles" ADD CONSTRAINT "buyer_agent_profiles_global_user_id_fkey" FOREIGN KEY ("global_user_id") REFERENCES "buyer_accounts"("global_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webauthn_credentials" ADD CONSTRAINT "webauthn_credentials_global_user_id_fkey" FOREIGN KEY ("global_user_id") REFERENCES "buyer_accounts"("global_user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_fkey" FOREIGN KEY ("coupon_id") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cross_sell_suggestions" ADD CONSTRAINT "cross_sell_suggestions_promo_id_fkey" FOREIGN KEY ("promo_id") REFERENCES "cross_sell_promotions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "self_checkout_wallets" ADD CONSTRAINT "self_checkout_wallets_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "self_checkout_buyer_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "self_checkout_saved_addresses" ADD CONSTRAINT "self_checkout_saved_addresses_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "self_checkout_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "self_checkout_saved_payment_methods" ADD CONSTRAINT "self_checkout_saved_payment_methods_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "self_checkout_wallets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "self_checkout_templates" ADD CONSTRAINT "self_checkout_templates_buyer_user_id_fkey" FOREIGN KEY ("buyer_user_id") REFERENCES "self_checkout_buyer_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "product_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_media" ADD CONSTRAINT "product_media_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_prices" ADD CONSTRAINT "product_prices_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_stock" ADD CONSTRAINT "product_stock_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "product_collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_products" ADD CONSTRAINT "collection_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_items" ADD CONSTRAINT "return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_labels" ADD CONSTRAINT "return_labels_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_inspections" ADD CONSTRAINT "return_inspections_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "return_refunds" ADD CONSTRAINT "return_refunds_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_team_members" ADD CONSTRAINT "merchant_team_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "merchant_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "story_categories" ADD CONSTRAINT "story_categories_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stories" ADD CONSTRAINT "stories_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "story_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_requests" ADD CONSTRAINT "budget_requests_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_variants" ADD CONSTRAINT "prompt_variants_experiment_id_fkey" FOREIGN KEY ("experiment_id") REFERENCES "prompt_experiments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prompt_variant_results" ADD CONSTRAINT "prompt_variant_results_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "prompt_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketplace_configs" ADD CONSTRAINT "marketplace_configs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_manager_hypotheses" ADD CONSTRAINT "revenue_manager_hypotheses_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "revenue_manager_observations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "revenue_manager_strategy_lessons" ADD CONSTRAINT "revenue_manager_strategy_lessons_hypothesis_id_fkey" FOREIGN KEY ("hypothesis_id") REFERENCES "revenue_manager_hypotheses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_recovery_strategy_prefs" ADD CONSTRAINT "cart_recovery_strategy_prefs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_channel_configs" ADD CONSTRAINT "whatsapp_channel_configs_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_movements" ADD CONSTRAINT "inventory_movements_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_alerts" ADD CONSTRAINT "inventory_alerts_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_alerts" ADD CONSTRAINT "inventory_alerts_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "inventory_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "erp_connections" ADD CONSTRAINT "erp_connections_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_connections" ADD CONSTRAINT "crm_connections_merchant_id_fkey" FOREIGN KEY ("merchant_id") REFERENCES "merchants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Custom partial indexes not represented by Prisma 6.
CREATE UNIQUE INDEX "negotiation_cost_ledger_entries_session_offer_applied_unique"
ON "negotiation_cost_ledger_entries" ("negotiation_session_id")
WHERE "event_type" = 'negotiation.offer_applied';
