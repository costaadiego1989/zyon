-- Add missing indexes on frequently-queried FK columns.
-- These cover the highest-traffic query patterns.

-- Checkout sessions: lookup by global user
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_checkout_session_global_user" ON "checkout_sessions" ("global_user_id");

-- Merchant rules: lookup by merchant
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_merchant_rule_merchant" ON "merchant_rules" ("merchant_id");

-- Negotiation sessions: lookup by global user
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_negotiation_session_global_user" ON "negotiation_sessions" ("global_user_id");

-- Payment intents: lookup by accepted offer
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_payment_intent_accepted_offer" ON "payment_intents" ("accepted_offer_id");

-- Buyer accounts: lookup by global user
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_buyer_account_global_user" ON "buyer_accounts" ("global_user_id");

-- Buyer preferences: lookup by global user
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_buyer_preference_global_user" ON "buyer_preferences" ("global_user_id");

-- Buyer agent profiles: lookup by global user
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_buyer_agent_profile_global_user" ON "buyer_agent_profiles" ("global_user_id");

-- Commerce pending orders: lookup by session
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_commerce_pending_order_session" ON "commerce_pending_orders" ("session_id");

-- Completed orders: lookup by accepted offer
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_completed_order_accepted_offer" ON "completed_orders" ("accepted_offer_id");

-- Shipments: lookup by session
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_shipment_session" ON "shipments" ("session_id");

-- Merchant commerce connections: lookup by merchant
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_merchant_commerce_conn_merchant" ON "merchant_commerce_connections" ("merchant_id");

-- Merchant payment connections: lookup by merchant
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_merchant_payment_conn_merchant" ON "merchant_payment_connections" ("merchant_id");

-- Outbox messages: lookup by event ID for dedup
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_outbox_message_event" ON "outbox_messages" ("event_id");

-- Coupon redemptions: lookup by order
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_coupon_redemption_order" ON "coupon_redemptions" ("order_id");
