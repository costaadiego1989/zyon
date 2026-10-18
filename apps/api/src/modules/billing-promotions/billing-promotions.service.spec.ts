import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { ConflictException, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import Stripe from "stripe";
import { BillingPromotionsService } from "./billing-promotions.service.js";
import { BillingPromotionsController } from "./billing-promotions.controller.js";
import { hasPlatformPermission, PLATFORM_OPERATOR_ROLES } from "../platform-control/domain/platform-operator.js";
import { PLATFORM_PERMISSIONS_METADATA } from "../platform-control/presentation/platform-permission.decorator.js";

function harness() {
  let rows = new Map<string, any>();
  const coupons = new Map<string, any>(); const codes = new Map<string, any>();
  const audits: any[] = []; const calls: any[] = [];
  const repository = {
    findUnique: async ({ where }: any) => rows.get(where.id) ?? [...rows.values()].find(row => row.code === where.code),
    create: async ({ data }: any) => { const row = { ...data, revision: 1, enabled: true, provisioned: false, deletedAt: null, stripeCouponId: null, stripePromotionCodeId: null, createdAt: new Date(), updatedAt: new Date() }; rows.set(row.id, row); return row; },
    update: async ({ where, data }: any) => { const row = { ...rows.get(where.id), ...data }; rows.set(row.id, row); return row; },
    findMany: async (args: any) => { calls.push({ type: "findMany", args }); return [...rows.values()].filter(row => !row.deletedAt).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(args.skip ?? 0, args.take === undefined ? undefined : (args.skip ?? 0) + args.take); },
    count: async () => [...rows.values()].filter(row => !row.deletedAt).length,
  };
  const tx = { billingPromotion: repository, $queryRaw: async () => [], platformAuditEvent: { create: async (args: any) => { audits.push(args.data); return args.data; } } };
  const prisma = { ...tx, $transaction: async (action: any) => {
    if (Array.isArray(action)) return Promise.all(action);
    const snapshot = structuredClone(rows); const previousAudits = audits.length;
    try { return await action(tx); } catch (error) { rows = snapshot; audits.splice(previousAudits); throw error; }
  } };
  const stripe = {
    prices: { retrieve: async (id: string) => ({ active: true, unit_amount: id === "starter179" ? 17900 : id === "growth" ? 44900 : 74900, currency: "brl", product: `prod_${id}`, recurring: { interval: "month", interval_count: 1 } }) },
    coupons: {
      retrieve: async (id: string) => { const coupon = coupons.get(id); if (!coupon) throw new Stripe.errors.StripeInvalidRequestError({ message: "missing", code: "resource_missing" }); return coupon; },
      create: async (data: any) => { calls.push({ type: "coupon.create", data }); const coupon = { ...data, valid: true }; coupons.set(data.id, coupon); return coupon; },
    },
    promotionCodes: {
      list: async ({ code }: any) => ({ data: [...codes.values()].filter(p => p.code === code) }),
      retrieve: async (id: string) => { const found = codes.get(id); if (!found) throw new Error("missing_promo"); return found; },
      create: async (data: any) => { calls.push({ type: "promotion.create", data }); const promo = { ...data, id: `promo_${codes.size + 1}`, times_redeemed: 0, livemode: false }; codes.set(promo.id, promo); return promo; },
      update: async (id: string, data: any) => { const promo = { ...codes.get(id), ...data }; codes.set(id, promo); return promo; },
    },
  };
  process.env.STRIPE_BILLING_PRICE_STARTER_179 = "starter179";
  process.env.STRIPE_BILLING_PRICE_GROWTH = "growth";
  process.env.STRIPE_BILLING_PRICE_SCALE = "scale";
  delete process.env.BILLING_PROMOTIONS_ENABLED;
  const service = new BillingPromotionsService(prisma as never, stripe as never);
  const body = { id: randomUUID(), code: "BLACKFRIDAY", name: "Black Friday", discountType: "percent", discountValue: 5000, duration: "repeating", durationMonths: 3, plans: ["starter179", "growth"], startsAt: new Date(Date.now() - 3600000).toISOString(), expiresAt: new Date(Date.now() + 86400000).toISOString(), maxRedemptions: 100, firstTimeOnly: false };
  const audit = { operatorId: "operator-admin", correlationId: randomUUID() };
  return { service, stripe, prisma, body, audit, coupons, codes, calls, audits, row: (id: string) => rows.get(id) };
}

test("checkout resolves a normalized campaign code to its scoped Stripe promotion", async () => {
  const h = harness(); const created = await h.service.create(h.body, h.audit);
  assert.equal(await h.service.resolveForCheckout({ code: "  blackfriday ", plan: "growth", cycle: "monthly" }), created.stripePromotionCodeId);
  assert.equal(h.codes.get(created.stripePromotionCodeId!).times_redeemed, 0);
});

test("automatic campaigns expose only explicit public data and preserve the selected plans", async () => {
  const h = harness(); await h.service.create({ ...h.body, autoApply: true, plans: ["growth", "scale"] }, h.audit);
  const campaigns = await h.service.automatic(); assert.equal(campaigns.length, 1);
  assert.deepEqual(campaigns[0].plans, ["growth", "scale"]); assert.equal(campaigns[0].discountValue, 5000);
  assert.deepEqual(Object.keys(campaigns[0]).sort(), ["code", "name", "plans", "discountType", "discountValue", "duration", "durationMonths", "startsAt", "expiresAt", "firstTimeOnly"].sort());
  assert.doesNotMatch(JSON.stringify(campaigns), /promo_|stripe|createdBy|operator-admin/);
});
for (const state of ["private", "disabled", "deleted", "pending", "scheduled", "expired", "exhausted", "provider-inactive"] as const) {
  test(`automatic campaigns hide ${state} coupons`, async () => {
    const h = harness(); const created = await h.service.create({ ...h.body, autoApply: state !== "private" }, h.audit);
    const row = h.row(created.id); const code = h.codes.get(created.stripePromotionCodeId!);
    if (state === "disabled") row.enabled = false;
    if (state === "deleted") row.deletedAt = new Date();
    if (state === "pending") row.provisioned = false;
    if (state === "scheduled") row.startsAt = new Date(Date.now() + 60000);
    if (state === "expired") row.expiresAt = new Date(Date.now() - 1);
    if (state === "exhausted") code.times_redeemed = row.maxRedemptions;
    if (state === "provider-inactive") code.active = false;
    assert.deepEqual(await h.service.automatic(), []);
  });
}

test("automatic campaigns are empty when disabled and fail closed on provider outage", async () => {
  const h = harness(); await h.service.create({ ...h.body, autoApply: true }, h.audit);
  h.stripe.promotionCodes.retrieve = async () => { throw new Error("private_failure"); };
  await assert.rejects(() => h.service.automatic(), /billing_promotions_unavailable/);
  process.env.BILLING_PROMOTIONS_ENABLED = "false";
  try { assert.deepEqual(await h.service.automatic(), []); } finally { delete process.env.BILLING_PROMOTIONS_ENABLED; }
});

for (const scenario of ["missing", "malformed", "annual", "wrong-plan", "disabled", "deleted", "pending", "scheduled", "expired", "exhausted", "stripe-inactive", "wrong-owner"] as const) {
  test(`checkout rejects campaign: ${scenario}`, async () => {
    const h = harness(); const created = await h.service.create(h.body, h.audit);
    const row = h.row(created.id); const code = h.codes.get(created.stripePromotionCodeId!);
    if (scenario === "disabled") row.enabled = false;
    if (scenario === "deleted") row.deletedAt = new Date();
    if (scenario === "pending") row.provisioned = false;
    if (scenario === "scheduled") row.startsAt = new Date(Date.now() + 60000);
    if (scenario === "expired") row.expiresAt = new Date(Date.now() - 1);
    if (scenario === "exhausted") code.times_redeemed = row.maxRedemptions;
    if (scenario === "stripe-inactive") code.active = false;
    if (scenario === "wrong-owner") code.metadata = { zyon_billing_campaign_id: "another-campaign" };
    await assert.rejects(() => h.service.resolveForCheckout({
      code: scenario === "missing" ? "UNKNOWN" : scenario === "malformed" ? "promo_private?" : "BLACKFRIDAY",
      plan: scenario === "wrong-plan" ? "scale" : "growth", cycle: scenario === "annual" ? "annual" : "monthly",
    }), /billing_promotion_/);
  });
}

test("checkout fails closed if campaigns are disabled or Stripe is unavailable", async () => {
  const h = harness(); await h.service.create(h.body, h.audit);
  h.stripe.promotionCodes.retrieve = async () => { throw new Error("provider_private_details"); };
  await assert.rejects(() => h.service.resolveForCheckout({ code: "BLACKFRIDAY", plan: "growth", cycle: "monthly" }), /billing_promotions_unavailable/);
  process.env.BILLING_PROMOTIONS_ENABLED = "false";
  try { await assert.rejects(() => h.service.resolveForCheckout({ code: "BLACKFRIDAY", plan: "growth", cycle: "monthly" }), (error: any) => error.getResponse().code === "billing_promotions_unavailable"); }
  finally { delete process.env.BILLING_PROMOTIONS_ENABLED; }
});

test("creates one restricted Stripe coupon and promotion, and retries return the same objects", async () => {
  const h = harness(); const created = await h.service.create(h.body, h.audit);
  assert.equal(created.status, "active"); assert.equal(created.timesRedeemed, 0);
  const coupon = h.calls.find(call => call.type === "coupon.create").data;
  assert.equal(coupon.percent_off, 50); assert.equal(coupon.duration_in_months, 3);
  assert.deepEqual(coupon.applies_to.products.sort(), ["prod_growth", "prod_starter179"]);
  assert.deepEqual(coupon.expand, ["applies_to"]);
  const repeat = await h.service.create(h.body, h.audit);
  assert.equal(repeat.stripePromotionCodeId, created.stripePromotionCodeId);
  assert.equal(h.coupons.size, 1); assert.equal(h.codes.size, 1);
  assert.ok(h.audits.some(audit => audit.action === "platform.billing_promotion.created"));
});
test("refuses to publish a promotion if Stripe does not confirm the product scope", async () => {
  const h = harness(); h.stripe.coupons.create = async (data: any) => ({ ...data, applies_to: undefined });
  await assert.rejects(() => h.service.create(h.body, h.audit), /billing_promotion_product_restriction_missing/);
  assert.equal(h.codes.size, 0); assert.equal(h.row(h.body.id).provisioned, false);
});

test("keeps full campaign names locally and respects Stripe's 40-character display limit", async () => {
  const h = harness();
  const name = "Campanha Black Friday com desconto especial de lançamento";
  const create = h.stripe.coupons.create;
  h.stripe.coupons.create = async (data: any) => {
    assert.ok(Array.from(data.name).length <= 40);
    return create(data);
  };
  const saved = await h.service.create({ ...h.body, name }, h.audit);
  assert.equal(saved.name, name);
  assert.equal(h.calls.find(call => call.type === "coupon.create").data.name, Array.from(name).slice(0, 40).join(""));
});
test("fixed amount uses integer cents, and a future campaign is initially disabled in Stripe", async () => {
  const h = harness();
  const saved = await h.service.create({ ...h.body, discountType: "fixed", discountValue: 17800, plans: ["starter179"], startsAt: new Date(Date.now() + 3600000).toISOString() }, h.audit);
  assert.equal(saved.status, "scheduled"); assert.equal(saved.stripeActive, false);
  const coupon = h.calls.find(call => call.type === "coupon.create").data;
  assert.equal(coupon.amount_off, 17800); assert.equal(coupon.currency, "brl");
});
test("supports disable and enable; a used-up code cannot be enabled again", async () => {
  const h = harness(); const saved = await h.service.create(h.body, h.audit);
  assert.equal((await h.service.setEnabled(saved.id, false, h.audit)).status, "paused");
  assert.equal(h.codes.get(saved.stripePromotionCodeId!).active, false);
  assert.equal((await h.service.setEnabled(saved.id, true, h.audit)).status, "active");
  h.codes.get(saved.stripePromotionCodeId!).times_redeemed = 100;
  await assert.rejects(() => h.service.setEnabled(saved.id, true, h.audit), ConflictException);
});
test("editing an unused code versions the provider discount and disables the prior code", async () => {
  const h = harness(); const first = await h.service.create(h.body, h.audit);
  const second = await h.service.update(first.id, { ...h.body, discountValue: 2500 }, h.audit);
  assert.notEqual(first.stripeCouponId, second.stripeCouponId);
  assert.notEqual(first.stripePromotionCodeId, second.stripePromotionCodeId);
  assert.equal(h.codes.get(first.stripePromotionCodeId!).active, false);
  assert.equal(h.codes.get(second.stripePromotionCodeId!).active, true);
  assert.equal(second.discountValue, 2500);
});
test("editing a redeemed discount is refused without changing the active promotion", async () => {
  const h = harness(); const saved = await h.service.create(h.body, h.audit);
  h.codes.get(saved.stripePromotionCodeId!).times_redeemed = 1;
  await assert.rejects(() => h.service.update(saved.id, { ...h.body, discountValue: 2500 }, h.audit), ConflictException);
  assert.equal(h.codes.get(saved.stripePromotionCodeId!).active, true);
  assert.equal(h.coupons.size, 1);
});
test("deletion disables redemption, hides the record, retains audit and cannot be re-enabled", async () => {
  const h = harness(); const saved = await h.service.create(h.body, h.audit);
  await h.service.remove(saved.id, h.audit);
  assert.equal(h.codes.get(saved.stripePromotionCodeId!).active, false);
  assert.ok(h.row(saved.id).deletedAt);
  assert.equal((await h.service.list()).pagination.total, 0);
  await assert.rejects(() => h.service.setEnabled(saved.id, true, h.audit), NotFoundException);
  assert.ok(h.audits.some(audit => audit.action.endsWith(".deleted")));
});
test("server pagination and filters are applied before retrieving Stripe objects", async () => {
  const h = harness(); await h.service.list({ page: "3", pageSize: "10", search: "TEST", status: "disabled", plan: "scale", discountType: "fixed" });
  const args = h.calls.find(call => call.type === "findMany").args;
  assert.equal(args.take, 10); assert.equal(args.skip, 20);
  assert.equal(args.where.enabled, false); assert.equal(args.where.deletedAt, null);
  assert.equal(args.where.discountType, "fixed"); assert.deepEqual(args.where.plans, { has: "scale" });
});
test("all writes require the platform-admin promotion permission; merchant and support roles cannot write", () => {
  for (const role of PLATFORM_OPERATOR_ROLES) assert.equal(hasPlatformPermission(role, "platform:billing-promotions:write"), role === "platform_admin");
  const reflector = new Reflector();
  for (const method of ["create", "toggle", "retry", "update", "remove"] as const) {
    assert.deepEqual(reflector.get(PLATFORM_PERMISSIONS_METADATA, BillingPromotionsController.prototype[method]), ["platform:billing-promotions:write"]);
  }
  assert.deepEqual(reflector.get(PLATFORM_PERMISSIONS_METADATA, BillingPromotionsController.prototype.list), ["platform:billing:read"]);
});
