import { describe, it, expect, beforeEach } from "vitest";
import { TrackCheckoutEventUseCase } from "../application/use-cases/track-checkout-event.use-case";
import type { CheckoutSessionRepository } from "../domain/ports/checkout-session.repository.port";
import type { CheckoutSettingsPort } from "../domain/ports/checkout-settings.port";
import type { MerchantRulesRepository } from "../../merchant/domain/ports/merchant-rules.repository.port";
import type { OutboxRepository } from "../../../shared/messaging/ports/outbox.repository.port";
import type { CheckoutSession, MerchantRules } from "@zyon/shared-types";

/**
 * Test cumulative discount when progressiveMode = "both".
 * Advanced rules apply first (e.g. 15% off), then progressive
 * should stack on top (e.g. +5% more) respecting maxDiscountPercent cap.
 */
describe("TrackCheckoutEventUseCase — cumulative discount (progressiveMode='both')", () => {
  let useCase: TrackCheckoutEventUseCase;
  let mockSessions: CheckoutSessionRepository;
  let mockSettings: CheckoutSettingsPort;
  let mockMerchantRules: MerchantRulesRepository;
  let mockOutbox: OutboxRepository;

  beforeEach(() => {
    mockSessions = {
      getSession: async (merchantId: string, sessionId: string) => ({
        merchantId,
        sessionId,
        globalUserId: "buyer_1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        abandonmentScore: 0.5,
        triggerAgent: false,
        cart: {
          items: [
            { sku: "SKU1", price: 100, quantity: 1, name: "Produto", cost: 50 },
          ],
          total: 100,
          currentDiscount: 0,
          source: "checkout",
        },
        shipping: { customerPrice: 10 },
        customer: { phone: "" },
      } as unknown as CheckoutSession),
      recordEvent: async () => {},
      saveSession: async (session: CheckoutSession) => {
        mockSessions.getSession = async () => session;
      },
    } as unknown as CheckoutSessionRepository;

    mockSettings = {
      getContext: async (merchantId: string) => ({
        merchant_id: merchantId,
        checkout_settings: {
          mode: "silent_until_trigger",
          enabled_triggers: ["coupon_field_clicked", "payment_nudge"],
          minimum_abandonment_score: 0.3,
          progressive_discount: {
            enabled: true,
            mode: "both",
            maxProgressivePercent: 25,
            stages: {
              initial_coupon: 5,
              exit_intent: 7,
              abandoned_cart: 10,
              payment_nudge: 5,
            },
          },
        },
        merchant_rules: [],
        operational_constraints: [],
      } as any),
    } as unknown as CheckoutSettingsPort;

    mockMerchantRules = {
      getRules: async (merchantId: string) => ({
        merchantId,
        maxDiscountPercent: 20, // merchant cap: max 20% total
        minimumMarginPercent: 25,
        couponBoxEnabled: true,
      } as unknown as MerchantRules),
    } as unknown as MerchantRulesRepository;

    mockOutbox = {
      appendOutbox: async () => {},
    } as unknown as OutboxRepository;

    useCase = new TrackCheckoutEventUseCase(
      mockSessions,
      mockOutbox,
      mockSettings,
      mockMerchantRules
    );
  });

  it("progressive stacks on advanced discount when mode='both'", async () => {
    // Simulate: advanced rule already applied 15% discount
    // Session cart has currentDiscount = 15
    let session = await mockSessions.getSession("merchant_1", "sess_1");
    session = {
      ...session,
      cart: { ...session.cart, currentDiscount: 15 }, // 15% already applied
    };
    await mockSessions.saveSession(session);

    // Trigger: payment_nudge (stage: 5% more)
    const result = await useCase.execute({
      merchant_id: "merchant_1",
      session_id: "sess_1",
      event: "payment_nudge",
      metadata: {},
    });

    // Expected: 15% + 5% = 20% total (merchant's cap)
    // evaluateDiscountOffer will clamp to merchant.maxDiscountPercent = 20
    expect(result.progressive_offer).toBeDefined();
    expect(result.progressive_offer?.approved_percent).toBe(20); // 15+5 clamped to merchant cap 20
    expect(result.progressive_offer?.reason).toContain("cumulative");
  });

  it("respects maxProgressivePercent when mode='both'", async () => {
    // Simulate: advanced rule already applied 20% (at merchant cap)
    let session = await mockSessions.getSession("merchant_1", "sess_1");
    session = {
      ...session,
      cart: { ...session.cart, currentDiscount: 20 }, // already at merchant cap
    };
    await mockSessions.saveSession(session);

    // Trigger: payment_nudge (would add 5% more = 25% total)
    // But maxProgressivePercent = 25 (policy limit for progressive specifically)
    // AND merchant.maxDiscountPercent = 20 (hard floor)
    // Result: skip because current discount already matches / exceeds approved value
    const result = await useCase.execute({
      merchant_id: "merchant_1",
      session_id: "sess_1",
      event: "payment_nudge",
      metadata: {},
    });

    expect(result.progressive_offer).toBeUndefined();
  });

  it("progressive_only mode does NOT stack (current behavior)", async () => {
    // Override settings to progressive_only
    mockSettings.getContext = async (merchantId: string) => ({
      merchant_id: merchantId,
      checkout_settings: {
        mode: "silent_until_trigger",
        enabled_triggers: ["payment_nudge"],
        progressive_discount: {
          enabled: true,
          mode: "progressive_only", // NOT cumulative
          stages: { payment_nudge: 5 },
        },
      },
      merchant_rules: [],
      operational_constraints: [],
    } as any);

    let session = await mockSessions.getSession("merchant_1", "sess_1");
    session = {
      ...session,
      cart: { ...session.cart, currentDiscount: 15 }, // 15% from advanced
    };
    await mockSessions.saveSession(session);

    const result = await useCase.execute({
      merchant_id: "merchant_1",
      session_id: "sess_1",
      event: "payment_nudge",
      metadata: {},
    });

    // Progressive target is 5%, but buyer already has 15%, so progressive skips
    expect(result.progressive_offer).toBeUndefined();
  });
});
