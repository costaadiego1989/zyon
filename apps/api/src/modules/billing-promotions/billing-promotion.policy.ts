import { BadRequestException } from "@nestjs/common";
import { BILLING_PLANS } from "@zyon/shared-types";

export const PAID_PROMOTION_PLANS = ["starter179", "growth", "scale"] as const;
export type PromotionPlan = (typeof PAID_PROMOTION_PLANS)[number];
export type PromotionInput = {
  id: string; code: string; name: string; discountType: "percent" | "fixed";
  /** Percentage in basis points; fixed discount in BRL cents. */
  discountValue: number; duration: "once" | "repeating" | "forever"; durationMonths: number | null;
  plans: PromotionPlan[]; startsAt: Date; expiresAt: Date;
  maxRedemptions: number | null; firstTimeOnly: boolean; autoApply: boolean;
};

export function promotionPolicy(env = process.env) {
  const months = Number(env.BILLING_PROMOTION_MAX_MONTHS ?? 36);
  const minimum = Number(env.BILLING_PROMOTION_MIN_CHARGE_CENTS ?? 50);
  return {
    maxMonths: Number.isSafeInteger(months) && months >= 1 && months <= 36 ? months : 36,
    minChargeCents: Number.isSafeInteger(minimum) && minimum >= 50 ? minimum : 50,
  };
}

export function parsePromotion(input: Record<string, unknown>, now = new Date(), env = process.env): PromotionInput {
  const fail = (field: string): never => { throw new BadRequestException({ code: "billing_promotion_invalid", field, detail: "Revise as condições do cupom." }); };
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("body");
  const id = typeof input.id === "string" ? input.id : "";
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) fail("id");
  const code = typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
  if (!/^[A-Z0-9-]{3,40}$/.test(code)) fail("code");
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 3 || name.length > 120) fail("name");
  if (input.discountType !== "percent" && input.discountType !== "fixed") fail("discountType");
  const value = input.discountValue;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) fail("discountValue");
  if (input.discountType === "percent" && (value as number) > 10000) fail("discountValue");
  if (!["once", "repeating", "forever"].includes(String(input.duration))) fail("duration");
  const { maxMonths, minChargeCents: minimum } = promotionPolicy(env);
  const durationMonths = input.duration === "repeating" ? input.durationMonths : null;
  if (input.duration === "repeating" && (typeof durationMonths !== "number" || !Number.isInteger(durationMonths) || durationMonths < 1 || durationMonths > maxMonths)) fail("durationMonths");
  if (!Array.isArray(input.plans) || !input.plans.length || input.plans.some(p => !PAID_PROMOTION_PLANS.includes(p))) fail("plans");
  const plans = [...new Set(input.plans as PromotionPlan[])].sort();
  const startsAt = input.startsAt ? new Date(String(input.startsAt)) : now;
  const expiresAt = new Date(String(input.expiresAt));
  if (!Number.isFinite(startsAt.getTime())) fail("startsAt");
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= startsAt || expiresAt <= now || expiresAt.getTime() > now.getTime() + 365 * 5 * 86400000) fail("expiresAt");
  const maxRedemptions = input.maxRedemptions == null ? null : input.maxRedemptions;
  if (maxRedemptions !== null && (typeof maxRedemptions !== "number" || !Number.isSafeInteger(maxRedemptions) || maxRedemptions < 1)) fail("maxRedemptions");
  if (input.firstTimeOnly !== undefined && typeof input.firstTimeOnly !== "boolean") fail("firstTimeOnly");
  if (input.autoApply !== undefined && typeof input.autoApply !== "boolean") fail("autoApply");
  for (const plan of plans) {
    const base = Math.round(BILLING_PLANS[plan].monthlyPriceBrl * 100);
    const discount = input.discountType === "percent" ? Math.round(base * (value as number) / 10000) : value as number;
    const total = base - discount;
    if (total < 0 || (total > 0 && total < minimum)) fail("discountValue");
  }
  return { id, code, name, discountType: input.discountType as PromotionInput["discountType"], discountValue: value as number,
    duration: input.duration as PromotionInput["duration"], durationMonths: durationMonths as number | null,
    plans, startsAt, expiresAt, maxRedemptions: maxRedemptions as number | null, firstTimeOnly: input.firstTimeOnly === true, autoApply: input.autoApply === true };
}

export function promotionShouldBeActive(row: { enabled: boolean; startsAt: Date; expiresAt: Date; maxRedemptions: number | null }, used: number, now: Date): boolean {
  return row.enabled && row.startsAt <= now && row.expiresAt > now && (row.maxRedemptions === null || used < row.maxRedemptions);
}

export function parsePromotionQuery(input: Record<string, unknown>, now = new Date()) {
  const invalid = (): never => { throw new BadRequestException("billing_promotion_invalid_filter"); };
  const page = input.page === undefined ? 1 : Number(input.page);
  const pageSize = input.pageSize === undefined ? 10 : Number(input.pageSize);
  if (!Number.isInteger(page) || page < 1 || page > 10000 || ![10, 25, 50].includes(pageSize)) invalid();
  const search = typeof input.search === "string" ? input.search.trim() : "";
  if (search.length > 120) invalid();
  if (input.plan && !PAID_PROMOTION_PLANS.includes(input.plan as PromotionPlan)) invalid();
  if (input.discountType && !["percent", "fixed"].includes(String(input.discountType))) invalid();
  if (input.status && !["enabled", "disabled", "scheduled", "expired", "pending"].includes(String(input.status))) invalid();
  const where = {
    deletedAt: null,
    ...(search ? { OR: [{ code: { contains: search, mode: "insensitive" as const } }, { name: { contains: search, mode: "insensitive" as const } }] } : {}),
    ...(input.plan ? { plans: { has: input.plan as string } } : {}),
    ...(input.discountType ? { discountType: input.discountType as string } : {}),
    ...(input.status === "enabled" ? { enabled: true } : {}),
    ...(input.status === "disabled" ? { enabled: false } : {}),
    ...(input.status === "scheduled" ? { enabled: true, provisioned: true, startsAt: { gt: now }, expiresAt: { gt: now } } : {}),
    ...(input.status === "expired" ? { expiresAt: { lte: now } } : {}),
    ...(input.status === "pending" ? { provisioned: false } : {}),
  };
  return { page, pageSize, where };
}
