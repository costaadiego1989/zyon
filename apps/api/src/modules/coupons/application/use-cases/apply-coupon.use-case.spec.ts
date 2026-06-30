import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ApplyCouponUseCase } from "./apply-coupon.use-case.js";
import { CouponEntity } from "../../domain/entities/coupon.entity.js";
import { InMemoryCouponRepository } from "../../infrastructure/repositories/in-memory-coupon.repository.js";
import { InMemoryCouponRedemptionRepository } from "../../infrastructure/repositories/in-memory-coupon-redemption.repository.js";
import { InMemoryOutboxRepository } from "../../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import type { Cart, MerchantRules } from "@zyon/shared-types";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import type { DiscountRulesEnginePort, DiscountAuthorization } from "../../domain/ports/discount-rules-engine.port.js";

// Stub that approves the full requested discount (permissive for most tests)
class AllowAllDiscountEngine implements DiscountRulesEnginePort {
  authorizeDiscount(
    _cart: Cart,
    _rules: MerchantRules,
    requestedValue: number,
    _type: "percent" | "fixed"
  ): DiscountAuthorization {
    return { approved: true, authorizedDiscount: requestedValue, reason: "discount_allowed" };
  }
}

// Stub that always rejects (for P0 regression tests)
class RejectAllDiscountEngine implements DiscountRulesEnginePort {
  authorizeDiscount(): DiscountAuthorization {
    return { approved: false, authorizedDiscount: 0, reason: "minimum_margin_violation" };
  }
}

// Stub that caps discount at a given percent
class CappedDiscountEngine implements DiscountRulesEnginePort {
  constructor(private readonly maxPercent: number) {}
  authorizeDiscount(
    cart: Cart,
    _rules: MerchantRules,
    requestedValue: number,
    type: "percent" | "fixed"
  ): DiscountAuthorization {
    const pct = type === "percent" ? requestedValue : (cart.total > 0 ? (requestedValue / cart.total) * 100 : 0);
    const authorized = Math.min(pct, this.maxPercent);
    return { approved: true, authorizedDiscount: authorized, reason: authorized < requestedValue ? "capped_by_max_discount_rule" : "discount_allowed" };
  }
}

const PERMISSIVE_RULES: MerchantRules = {
  ...DEFAULT_MERCHANT_RULES,
  maxDiscountPercent: 100,
  minimumMarginPercent: 0,
  couponBoxEnabled: true,
};

function makeSetup(engine: DiscountRulesEnginePort = new AllowAllDiscountEngine()) {
  const couponRepo = new InMemoryCouponRepository();
  const redemptionRepo = new InMemoryCouponRedemptionRepository();
  const outbox = new InMemoryOutboxRepository();
  const useCase = new ApplyCouponUseCase(couponRepo, redemptionRepo, outbox, engine);
  return { couponRepo, redemptionRepo, outbox, useCase };
}

function makeCouponInput(overrides: Partial<{
  max_usages: number | null;
  max_per_buyer: number | null;
  discount_value: number;
  discount_type: "percent" | "fixed";
  status: "active" | "archived" | "expired";
}> = {}) {
  return {
    merchant_id: "mrc_1",
    code: "SAVE10",
    discount_type: (overrides.discount_type ?? "percent") as "percent" | "fixed",
    discount_value: overrides.discount_value ?? 10,
    min_cart_total: null,
    max_usages: overrides.max_usages ?? null,
    max_per_buyer: overrides.max_per_buyer ?? null,
    allowed_skus: [],
    blocked_skus: [],
    allowed_regions: [],
    blocked_regions: [],
    starts_at: new Date(Date.now() - 1000).toISOString(),
    ends_at: null,
  };
}

const BASE_CART: Cart = {
  items: [{ sku: "SKU-A", price: 100, quantity: 1, name: "Item A" }],
  total: 100,
  currency: "BRL",
};

const BASE_INPUT = {
  merchant_id: "mrc_1",
  session_id: "sess_1",
  code: "SAVE10",
  cart: BASE_CART,
  merchantRules: PERMISSIVE_RULES,
};

describe("ApplyCouponUseCase", () => {
  it("applies coupon and fires outbox event", async () => {
    const { couponRepo, outbox, useCase } = makeSetup();
    await couponRepo.save(CouponEntity.create(makeCouponInput()));

    await useCase.execute(BASE_INPUT);

    const events = outbox.listOutbox("mrc_1");
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "coupon.applied");
    const payload = events[0].payload as Record<string, unknown>;
    assert.equal(payload.session_id, "sess_1");
    assert.equal(payload.code, "SAVE10");
  });

  it("throws NotFoundException when coupon code not found", async () => {
    const { useCase } = makeSetup();
    await assert.rejects(() => useCase.execute(BASE_INPUT), { message: "COUPON_NOT_FOUND" });
  });

  it("throws BadRequestException when coupon is archived", async () => {
    const { couponRepo, useCase } = makeSetup();
    const coupon = CouponEntity.create(makeCouponInput()).archive();
    await couponRepo.save(coupon);

    await assert.rejects(() => useCase.execute(BASE_INPUT), { message: "COUPON_INVALID" });
  });

  it("throws ConflictException when coupon already applied in same session", async () => {
    const { couponRepo, useCase } = makeSetup();
    await couponRepo.save(CouponEntity.create(makeCouponInput()));

    await useCase.execute(BASE_INPUT);

    await assert.rejects(
      () => useCase.execute(BASE_INPUT),
      { message: "COUPON_ALREADY_APPLIED" }
    );
  });

  it("throws BadRequestException when per-buyer limit is reached", async () => {
    const { couponRepo, useCase } = makeSetup();
    await couponRepo.save(CouponEntity.create(makeCouponInput({ max_per_buyer: 1 })));

    await useCase.execute({ ...BASE_INPUT, buyer_global_user_id: "usr_1" });

    await assert.rejects(
      () => useCase.execute({ ...BASE_INPUT, session_id: "sess_2", buyer_global_user_id: "usr_1" }),
      { message: "COUPON_PER_BUYER_LIMIT_REACHED" }
    );
  });

  // ── P0 regression: rules-engine must authorize discount ──────────────────

  it("P0: rejects coupon when rules-engine denies discount (margin violation)", async () => {
    const { couponRepo, useCase } = makeSetup(new RejectAllDiscountEngine());
    await couponRepo.save(CouponEntity.create(makeCouponInput({ discount_value: 90 })));

    await assert.rejects(
      () => useCase.execute(BASE_INPUT),
      (err: { message?: string }) => {
        assert.ok(err.message?.startsWith("COUPON_DISCOUNT_REJECTED"), `unexpected: ${err.message}`);
        return true;
      }
    );
  });

  it("P0: applies capped discount when rules-engine lowers it", async () => {
    const { couponRepo, outbox, useCase } = makeSetup(new CappedDiscountEngine(5));
    await couponRepo.save(CouponEntity.create(makeCouponInput({ discount_value: 10 }))); // requests 10%

    const result = await useCase.execute(BASE_INPUT);

    // Engine caps to 5%, cart.total = 100, so discount = 5
    assert.equal(result.discount_applied, 5);
    const events = outbox.listOutbox("mrc_1");
    assert.equal((events[0].payload as Record<string, unknown>).discount_applied, 5);
  });

  // ── P1 regression: countByCoupon counts applied + redeemed ───────────────

  it("P1: enforces max_usages counting in-flight (applied) redemptions", async () => {
    const { couponRepo, useCase } = makeSetup();
    await couponRepo.save(CouponEntity.create(makeCouponInput({ max_usages: 1 })));

    // First apply in session 1 → should succeed
    await useCase.execute({ ...BASE_INPUT, session_id: "sess_1" });

    // Second apply in session 2 → should fail because max_usages=1 is already used
    await assert.rejects(
      () => useCase.execute({ ...BASE_INPUT, session_id: "sess_2" }),
      { message: "COUPON_EXHAUSTED" }
    );
  });

  // ── P2 regression: findById scoped by merchantId ─────────────────────────

  it("P2: findById on redemption requires matching merchantId", async () => {
    const { couponRepo, redemptionRepo, useCase } = makeSetup();
    await couponRepo.save(CouponEntity.create(makeCouponInput()));

    const result = await useCase.execute(BASE_INPUT);

    // findById with wrong merchantId must return null
    const leaked = await redemptionRepo.findById(result.redemption_id, "mrc_OTHER");
    assert.equal(leaked, null, "cross-tenant findById must return null");

    // findById with correct merchantId returns the entity
    const found = await redemptionRepo.findById(result.redemption_id, "mrc_1");
    assert.ok(found, "same-tenant findById must return the entity");
  });
});
