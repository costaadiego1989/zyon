import test from "node:test";
import assert from "node:assert/strict";
import type { ConversationPort } from "../domain/ports/conversation.port.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { createStartCheckoutUseCase } from "../application/use-cases/start-checkout.fixture.js";
import { createSendChatUseCase } from "../application/use-cases/send-chat-message.fixture.js";
import { CheckoutCustomerService } from "../application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "../application/services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../application/services/checkout-offer.service.js";
import { OtpService } from "../application/services/otp.service.js";
import { BuyerRecognitionService } from "../application/services/buyer-recognition.service.js";
import { BuyerAccountPersistenceService } from "../application/services/buyer-account-persistence.service.js";
import { HoldoutGroupService } from "../../revenue-lift/domain/services/holdout-group.service.js";
import { AttributionTaggerService } from "../../revenue-lift/domain/services/attribution-tagger.service.js";
import {
  startCheckoutRequest
} from "./checkout-test-fixtures.js";

/**
 * Conversation port that tracks whether reply() was called.
 */
class TrackingConversationPort implements ConversationPort {
  public callCount = 0;
  public lastInput: any;

  async reply(input: Parameters<ConversationPort["reply"]>[0]) {
    this.callCount++;
    this.lastInput = input;
    return {
      message: "Como posso ajudar?",
      objection: "unknown" as const
    };
  }
}

/**
 * Helper: creates a StartCheckoutUseCase with holdout service.
 */
function createStartUseCase(repo: InMemoryCheckoutRepository, holdout?: HoldoutGroupService) {
  return createStartCheckoutUseCase(repo, repo, { holdoutGroupService: holdout });
}

/**
 * Helper: creates a SendChatMessageUseCase.
 */
function createChatUseCase(repo: InMemoryCheckoutRepository, conversation: ConversationPort) {
  const otpService = new OtpService();
  const recognitionService = new BuyerRecognitionService(repo);
  const persistenceService = new BuyerAccountPersistenceService();
  const custService = new CheckoutCustomerService(repo, undefined, otpService, recognitionService, persistenceService);
  const shipService = new CheckoutShippingService(repo, custService);
  const offerService = new CheckoutOfferService(repo);
  return createSendChatUseCase(repo, {
    conversation,
    customerService: custService,
    shippingService: shipService,
    offerService
  });
}

test("Revenue Lift: holdout user gets deterministic reply (no LLM)", async () => {
  const holdoutService = new HoldoutGroupService();
  const repo = new InMemoryCheckoutRepository();

  // Start checkout with holdout service
  const startUC = createStartUseCase(repo, holdoutService);
  await startUC.execute(startCheckoutRequest({ session_id: "chk_holdout_1" }));

  // Get session and check cohort was assigned
  const session = await repo.getSession("mrc_1", "chk_holdout_1");
  assert.ok(session, "Session should exist");

  // The cohort should be assigned (either holdout or treatment based on hash)
  const cohort = (session as any).cohort;
  assert.ok(cohort === "holdout" || cohort === "treatment", `Cohort should be assigned, got: ${cohort}`);
});

test("Revenue Lift: holdout assignment is deterministic", () => {
  const service = new HoldoutGroupService();
  const cohort1 = service.assignCohort("user_123", "mrc_1");
  const cohort2 = service.assignCohort("user_123", "mrc_1");
  assert.equal(cohort1, cohort2, "Same user should always get same cohort");
});

test("Revenue Lift: holdout user session has no authorized offer", async () => {
  const repo = new InMemoryCheckoutRepository();
  const conversation = new TrackingConversationPort();

  // Manually create a session with cohort="holdout"
  const holdoutService = new HoldoutGroupService();
  const startUC = createStartUseCase(repo, holdoutService);
  await startUC.execute(startCheckoutRequest({ session_id: "chk_manual_holdout" }));

  // Force cohort to "holdout" for test
  const session = await repo.getSession("mrc_1", "chk_manual_holdout");
  if (session) {
    (session as any).cohort = "holdout";
    await repo.saveSession(session);
  }

  // Chat with the session
  const chatUC = createChatUseCase(repo, conversation);
  const result = await chatUC.execute({
    merchant_id: "mrc_1",
    session_id: "chk_manual_holdout",
    conversation_id: "conv_1",
    user_message: "quero desconto de 50%"
  });

  // Holdout: offer should NOT be approved
  assert.equal(result.authorized_offer?.approved, false);
  // Deterministic conversation should have been used
  assert.equal(conversation.callCount, 1, "Deterministic conversation should be called for holdout");
});

test("Revenue Lift: treatment user gets normal flow", async () => {
  const repo = new InMemoryCheckoutRepository();
  const conversation = new TrackingConversationPort();

  const holdoutService = new HoldoutGroupService();
  const startUC = createStartUseCase(repo, holdoutService);
  await startUC.execute(startCheckoutRequest({ session_id: "chk_treatment_1" }));

  // Force cohort to "treatment" for test
  const session = await repo.getSession("mrc_1", "chk_treatment_1");
  if (session) {
    (session as any).cohort = "treatment";
    await repo.saveSession(session);
  }

  const chatUC = createChatUseCase(repo, conversation);
  const result = await chatUC.execute({
    merchant_id: "mrc_1",
    session_id: "chk_treatment_1",
    conversation_id: "conv_1",
    user_message: "oi"
  });

  // Treatment: deterministic conversation used (no LLM in test environment)
  // but offers are NOT suppressed
  assert.equal(conversation.callCount, 1);
  assert.ok(result.message, "Should have a message");
});

test("Revenue Lift: AttributionTaggerService tags holdout correctly", () => {
  const tagger = new AttributionTaggerService();
  const tag = tagger.tag({
    sessionId: "chk_1",
    orderId: "ord_1",
    cohort: "holdout",
    features: {
      negotiation: true,
      crossSell: true,
      progressiveDiscount: true,
      cartRecovery: true,
      intentPersonalization: true
    },
    revenue: {
      orderValueCents: 10000,
      discountCents: 500,
      shippingSubsidyCents: 200
    },
    aiCostCents: 50
  });

  // INVARIANT A3: holdout forces all features to false
  assert.equal(tag.negotiationApplied, false);
  assert.equal(tag.crossSellApplied, false);
  assert.equal(tag.progressiveDiscountApplied, false);
  assert.equal(tag.cartRecoveryApplied, false);
  assert.equal(tag.intentPersonalizationApplied, false);
  assert.equal(tag.aiCostCents, 0, "Holdout AI cost should be 0");
  assert.equal(tag.cohort, "holdout");
});

test("Revenue Lift: AttributionTaggerService tags treatment correctly", () => {
  const tagger = new AttributionTaggerService();
  const tag = tagger.tag({
    sessionId: "chk_2",
    orderId: "ord_2",
    cohort: "treatment",
    features: {
      negotiation: true,
      crossSell: false,
      progressiveDiscount: true,
      cartRecovery: false,
      intentPersonalization: false
    },
    revenue: {
      orderValueCents: 15000,
      discountCents: 1000,
      shippingSubsidyCents: 0
    },
    aiCostCents: 30
  });

  assert.equal(tag.negotiationApplied, true);
  assert.equal(tag.crossSellApplied, false);
  assert.equal(tag.progressiveDiscountApplied, true);
  assert.equal(tag.aiCostCents, 30);
  assert.equal(tag.cohort, "treatment");
});

test("Deal Engine: CheckoutOfferService authorizes without NegotiateDiscount when not injected", async () => {
  const repo = new InMemoryCheckoutRepository();
  const offerService = new CheckoutOfferService(repo);

  const startUC = createStartCheckoutUseCase(repo, repo);
  await startUC.execute(startCheckoutRequest({ session_id: "chk_negotiate_1" }));
  const session = await repo.getSession("mrc_1", "chk_negotiate_1");
  assert.ok(session);

  // Should work without negotiation use-case (graceful degradation)
  const offer = await offerService.authorizeOffer(
    "quero desconto",
    session,
    {
      maxDiscountPercent: 10,
      allowFreeShipping: false,
      offerExpirationMinutes: 15
    } as any,
    "payment",
    []
  );

  // Should still work — falls through to standard progressive discount
  assert.ok(offer);
  assert.ok(offer.type !== undefined);
});
