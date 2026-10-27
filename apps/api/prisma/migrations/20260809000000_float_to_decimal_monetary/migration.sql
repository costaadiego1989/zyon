-- Migration: Float → Decimal for all monetary fields
-- Strategy: expand-and-contract (this step only ALTERs type, no column rename)
-- Rollback: ALTER COLUMN TYPE DOUBLE PRECISION (reverses to Float)
-- Risk: LOW — Decimal(12,4) has higher precision than Float64 for monetary values

-- MerchantRule
ALTER TABLE "merchant_rules" ALTER COLUMN "max_discount_percent" TYPE DECIMAL(12,4);
ALTER TABLE "merchant_rules" ALTER COLUMN "minimum_margin_percent" TYPE DECIMAL(12,4);
ALTER TABLE "merchant_rules" ALTER COLUMN "free_shipping_min_cart_value" TYPE DECIMAL(12,4);
ALTER TABLE "merchant_rules" ALTER COLUMN "max_shipping_subsidy" TYPE DECIMAL(12,4);
ALTER TABLE "merchant_rules" ALTER COLUMN "max_partial_shipping_discount" TYPE DECIMAL(12,4);

-- AuthorizedOffer
ALTER TABLE "authorized_offers" ALTER COLUMN "value" TYPE DECIMAL(12,4);
ALTER TABLE "authorized_offers" ALTER COLUMN "margin_after_offer" TYPE DECIMAL(12,4);

-- AcceptedOffer
ALTER TABLE "accepted_offers" ALTER COLUMN "value" TYPE DECIMAL(12,4);
ALTER TABLE "accepted_offers" ALTER COLUMN "margin_after_offer" TYPE DECIMAL(12,4);

-- CompletedOrder
ALTER TABLE "completed_orders" ALTER COLUMN "order_total" TYPE DECIMAL(12,4);

-- BuyerPurchaseRecord
ALTER TABLE "buyer_purchase_records" ALTER COLUMN "total_amount" TYPE DECIMAL(12,4);
ALTER TABLE "buyer_purchase_records" ALTER COLUMN "discount_amount" TYPE DECIMAL(12,4);

-- BuyerAgentProfile
ALTER TABLE "buyer_agent_profiles" ALTER COLUMN "target_discount_percent" TYPE DECIMAL(12,4);
ALTER TABLE "buyer_agent_profiles" ALTER COLUMN "minimum_acceptable_discount_percent" TYPE DECIMAL(12,4);
ALTER TABLE "buyer_agent_profiles" ALTER COLUMN "auto_accept_threshold" TYPE DECIMAL(12,4);

-- Coupon
ALTER TABLE "coupons" ALTER COLUMN "discount_value" TYPE DECIMAL(12,4);
ALTER TABLE "coupons" ALTER COLUMN "min_cart_total" TYPE DECIMAL(12,4);

-- CouponRedemption
ALTER TABLE "coupon_redemptions" ALTER COLUMN "discount_applied" TYPE DECIMAL(12,4);

-- CrossSellPromotion
ALTER TABLE "cross_sell_promotions" ALTER COLUMN "discount_percent" TYPE DECIMAL(12,4);
ALTER TABLE "cross_sell_promotions" ALTER COLUMN "max_discount_percent" TYPE DECIMAL(12,4);

-- CrossSellSuggestion
ALTER TABLE "cross_sell_suggestions" ALTER COLUMN "computed_discount" TYPE DECIMAL(12,4);

-- CheckoutSession (non-monetary but also benefits from Decimal for scoring)
-- KEEP as Float: abandonmentScore is a 0-1 probability, Float is fine
