import type { Coupon as PrismaCoupon, CouponRedemption as PrismaCouponRedemption } from "@prisma/client";
import { CouponEntity, type CouponSnapshot, type CouponDiscountType, type CouponStatus } from "../../domain/entities/coupon.entity.js";
import { CouponRedemptionEntity, type CouponRedemptionSnapshot, type RedemptionSource, type RedemptionStatus } from "../../domain/entities/coupon-redemption.entity.js";

/**
 * Convert Prisma Coupon row to CouponEntity.
 */
export function toCouponEntity(row: PrismaCoupon): CouponEntity {
  const snap: CouponSnapshot = {
    id: row.id,
    merchant_id: row.merchantId,
    code: row.code,
    discount_type: row.discountType as CouponDiscountType,
    discount_value: row.discountValue,
    min_cart_total: row.minCartTotal,
    max_usages: row.maxUsages,
    max_per_buyer: row.maxPerBuyer,
    usages_count: row.usagesCount,
    allowed_skus: row.allowedSkus,
    blocked_skus: row.blockedSkus,
    allowed_regions: row.allowedRegions,
    blocked_regions: row.blockedRegions,
    status: row.status as CouponStatus,
    starts_at: row.startsAt.toISOString(),
    ends_at: row.endsAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
  return CouponEntity.rehydrate(snap);
}

/**
 * Convert CouponEntity to Prisma upsert create payload.
 */
export function toCouponCreateInput(entity: CouponEntity) {
  const snap = entity.snapshot();
  return {
    id: snap.id,
    merchantId: snap.merchant_id,
    code: snap.code,
    discountType: snap.discount_type,
    discountValue: snap.discount_value,
    minCartTotal: snap.min_cart_total,
    maxUsages: snap.max_usages,
    maxPerBuyer: snap.max_per_buyer,
    usagesCount: snap.usages_count,
    allowedSkus: snap.allowed_skus,
    blockedSkus: snap.blocked_skus,
    allowedRegions: snap.allowed_regions,
    blockedRegions: snap.blocked_regions,
    status: snap.status,
    startsAt: new Date(snap.starts_at),
    endsAt: snap.ends_at ? new Date(snap.ends_at) : null,
  };
}

/**
 * Convert CouponEntity to Prisma update payload.
 */
export function toCouponUpdateInput(entity: CouponEntity) {
  const snap = entity.snapshot();
  return {
    discountType: snap.discount_type,
    discountValue: snap.discount_value,
    minCartTotal: snap.min_cart_total,
    maxUsages: snap.max_usages,
    maxPerBuyer: snap.max_per_buyer,
    usagesCount: snap.usages_count,
    allowedSkus: snap.allowed_skus,
    blockedSkus: snap.blocked_skus,
    allowedRegions: snap.allowed_regions,
    blockedRegions: snap.blocked_regions,
    status: snap.status,
    startsAt: new Date(snap.starts_at),
    endsAt: snap.ends_at ? new Date(snap.ends_at) : null,
  };
}

/**
 * Convert Prisma CouponRedemption row to CouponRedemptionEntity.
 */
export function toCouponRedemptionEntity(row: PrismaCouponRedemption): CouponRedemptionEntity {
  const snap: CouponRedemptionSnapshot = {
    id: row.id,
    coupon_id: row.couponId,
    merchant_id: row.merchantId,
    session_id: row.sessionId,
    buyer_global_user_id: row.buyerGlobalUserId ?? null,
    discount_applied: row.discountApplied,
    source: row.source as RedemptionSource,
    status: row.status as RedemptionStatus,
    order_id: row.orderId ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString()
  };
  return CouponRedemptionEntity.rehydrate(snap);
}

/**
 * Convert CouponRedemptionEntity to Prisma create payload.
 */
export function toRedemptionCreateInput(entity: CouponRedemptionEntity) {
  const snap = entity.snapshot();
  return {
    id: snap.id,
    couponId: snap.coupon_id,
    merchantId: snap.merchant_id,
    sessionId: snap.session_id,
    buyerGlobalUserId: snap.buyer_global_user_id ?? null,
    discountApplied: snap.discount_applied,
    source: snap.source,
    status: snap.status,
    orderId: snap.order_id ?? null,
  };
}

/**
 * Convert CouponRedemptionEntity to Prisma update payload.
 */
export function toRedemptionUpdateInput(entity: CouponRedemptionEntity) {
  const snap = entity.snapshot();
  return {
    status: snap.status,
    orderId: snap.order_id ?? null,
  };
}
