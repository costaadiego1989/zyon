import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { CheckoutSession } from "@zyon/shared-types";
import { AcpCouponApplier } from "./acp-coupon.applier.js";
import type { CouponRepository } from "../../coupons/domain/ports/coupon-repository.port.js";
import type { MerchantRulesRepository } from "../../merchant/domain/ports/merchant-rules.repository.port.js";
import type { ApplyCouponUseCase } from "../../coupons/application/use-cases/apply-coupon.use-case.js";

function buildSession(): CheckoutSession {
  return {
    merchantId: "mrc_test",
    sessionId: "chk_test",
    globalUserId: "g_test",
    conversationId: "conv_test",
    cart: { currency: "BRL", total: 100, items: [] },
    abandonmentScore: 0,
    triggerAgent: false,
    chatHistory: [],
    createdAt: "2026-09-03T12:00:00.000Z",
    updatedAt: "2026-09-03T12:00:00.000Z",
  };
}

function createCoupons(byCode: Map<string, unknown>): CouponRepository {
  return {
    async findByCode(_m: string, code: string) {
      return byCode.get(code);
    },
  } as unknown as CouponRepository;
}

function createApplySpy(calls: unknown[]): ApplyCouponUseCase {
  return {
    async execute(input: unknown) {
      calls.push(input);
    },
  } as unknown as ApplyCouponUseCase;
}

function createRulesRepo(rules: unknown | undefined): MerchantRulesRepository {
  return {
    async getRules() {
      return rules as never;
    },
  } as unknown as MerchantRulesRepository;
}

test("coupon: throws when coupon repository unavailable", async () => {
  const applier = new AcpCouponApplier(createApplySpy([]), undefined, undefined);
  await assert.rejects(
    () => applier.applyCoupon(buildSession(), "X"),
    (err: unknown) =>
      err instanceof BadRequestException &&
      (err.getResponse() as { message: string }).message === "acp_coupons_unavailable",
  );
});

test("coupon: throws when code is empty after trim", async () => {
  const applier = new AcpCouponApplier(
    createApplySpy([]),
    createCoupons(new Map()),
    undefined,
  );
  await assert.rejects(
    () => applier.applyCoupon(buildSession(), "   "),
    (err: unknown) => err instanceof BadRequestException,
  );
});

test("coupon: throws NotFound when coupon not found", async () => {
  const applier = new AcpCouponApplier(
    createApplySpy([]),
    createCoupons(new Map()),
    undefined,
  );
  await assert.rejects(
    () => applier.applyCoupon(buildSession(), "NOPE"),
    (err: unknown) => err instanceof NotFoundException,
  );
});

test("coupon: passes DEFAULT_MERCHANT_RULES when merchant rules repo missing", async () => {
  const calls: unknown[] = [];
  const couponsByCode = new Map([["ABC10", { code: "ABC10" }]]);
  const applier = new AcpCouponApplier(createApplySpy(calls), createCoupons(couponsByCode), undefined);
  await applier.applyCoupon(buildSession(), "abc10");
  assert.equal(calls.length, 1);
  const args = calls[0] as { code: string; merchantRules: unknown };
  assert.equal(args.code, "abc10");
  assert.ok(args.merchantRules);
});

test("coupon: fetches merchant rules when repo provided", async () => {
  const calls: unknown[] = [];
  const couponsByCode = new Map([["ABC10", { code: "ABC10" }]]);
  const customRules = { maxDiscountPercent: 5 };
  const applier = new AcpCouponApplier(
    createApplySpy(calls),
    createCoupons(couponsByCode),
    createRulesRepo(customRules),
  );
  await applier.applyCoupon(buildSession(), "abc10");
  assert.equal((calls[0] as { merchantRules: unknown }).merchantRules, customRules);
});

test("coupon: passes session buyer global id and source manual", async () => {
  const calls: unknown[] = [];
  const couponsByCode = new Map([["ABC10", { code: "ABC10" }]]);
  const applier = new AcpCouponApplier(
    createApplySpy(calls),
    createCoupons(couponsByCode),
    undefined,
  );
  await applier.applyCoupon(buildSession(), "abc10");
  const args = calls[0] as {
    merchant_id: string;
    session_id: string;
    buyer_global_user_id: string;
    source: string;
  };
  assert.equal(args.merchant_id, "mrc_test");
  assert.equal(args.session_id, "chk_test");
  assert.equal(args.buyer_global_user_id, "g_test");
  assert.equal(args.source, "manual");
});
