import test from "node:test";
import assert from "node:assert/strict";
import type { CheckoutSession, CheckoutEventName } from "@zyon/shared-types";
import { ConflictException, ForbiddenException, BadRequestException } from "@nestjs/common";
import { AcpCheckoutLifecycleService } from "./acp-checkout-lifecycle.service.js";
import type { CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";
import type { MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import type { GetCheckoutSessionUseCase } from "../../checkout/application/use-cases/get-checkout-session.use-case.js";
import type { UpdateCartUseCase } from "../../checkout/application/use-cases/update-cart.use-case.js";
import type { CompleteOrderUseCase } from "../../checkout/application/use-cases/complete-order.use-case.js";
import type { ApplyCouponUseCase } from "../../coupons/application/use-cases/apply-coupon.use-case.js";
import type { CreatePaymentIntentUseCase } from "../../payment/application/create-payment-intent.use-case.js";
import type { CouponRepository } from "../../coupons/domain/ports/coupon-repository.port.js";
import type { MerchantRulesRepository } from "../../merchant/domain/ports/merchant-rules.repository.port.js";
import type { ProductVariantLookupPort } from "../../checkout/domain/ports/product-variant-lookup.port.js";
import type { EmbedTokenClaims } from "../../embed/domain/embed-token.service.js";

const NOW = "2026-09-03T12:00:00.000Z";

function buildSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    merchantId: "mrc_test",
    sessionId: "chk_test",
    globalUserId: "g_test",
    conversationId: "conv_test",
    cart: {
      currency: "BRL",
      total: 200,
      items: [{ sku: "sku_1", name: "P1", price: 100, quantity: 2 }],
    },
    abandonmentScore: 0,
    triggerAgent: false,
    chatHistory: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function createSessionRepo(events: CheckoutEventName[] = [], sessionOverride?: CheckoutSession): CheckoutSessionRepository & {
  savedSessions: CheckoutSession[];
  recordedEvents: Array<{ event: CheckoutEventName; metadata?: unknown }>;
} {
  let session = sessionOverride ?? buildSession();
  const recordedEvents: Array<{ event: CheckoutEventName; metadata?: unknown }> = [];
  const savedSessions: CheckoutSession[] = [];
  return {
    savedSessions,
    recordedEvents,
    async saveSession(s) {
      savedSessions.push(s);
      session = s;
    },
    async getSession() {
      return session;
    },
    async findSessionsByEmail() {
      return [session];
    },
    async appendChatTurn() {
      return session;
    },
    async recordEvent(_m, _s, event, metadata) {
      recordedEvents.push({ event, metadata });
    },
    async findSessionsWithTrigger() {
      return [session];
    },
    async getSessionEvents() {
      return events;
    },
  };
}

function createGetUseCase(sessionRepo: ReturnType<typeof createSessionRepo>): GetCheckoutSessionUseCase {
  const useCase: Partial<GetCheckoutSessionUseCase> = {
    async execute(_merchantId: string, _sessionId: string) {
      const lastSaved = sessionRepo.savedSessions.at(-1);
      const current = await sessionRepo.getSession(_merchantId, _sessionId);
      return lastSaved ?? current ?? buildSession();
    },
  };
  return useCase as GetCheckoutSessionUseCase;
}

function createMerchantRepo(slug?: string): MerchantRepository {
  return {
    async getProfile() {
      return slug ? { id: "mrc_test", name: "Test Merchant", slug } : { id: "mrc_test", name: "Test Merchant" };
    },
  } as unknown as MerchantRepository;
}

function makeClaims(scopes: EmbedTokenClaims["scopes"]): EmbedTokenClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    typ: "aacp_embed_v1",
    merchantId: "mrc_test",
    installationId: "inst_1",
    issuedAtUnix: now,
    expiresAtUnix: now + 3600,
    nonce: "n_1",
    scopes,
  };
}

function buildService(opts: {
  sessionRepo?: ReturnType<typeof createSessionRepo>;
  merchants?: MerchantRepository;
  complete?: CompleteOrderUseCase;
  payment?: CreatePaymentIntentUseCase;
  getUseCase?: GetCheckoutSessionUseCase;
  updateCart?: UpdateCartUseCase;
  applyCoupon?: ApplyCouponUseCase;
  variantLookup?: ProductVariantLookupPort;
  coupons?: CouponRepository;
  merchantRules?: MerchantRulesRepository;
} = {}): { service: AcpCheckoutLifecycleService; sessionRepo: ReturnType<typeof createSessionRepo> } {
  const sessionRepo = opts.sessionRepo ?? createSessionRepo();
  const getUseCase = opts.getUseCase ?? createGetUseCase(sessionRepo);
  const service = new AcpCheckoutLifecycleService(
    getUseCase,
    (opts.updateCart ?? stubUseCase<UpdateCartUseCase>()) as UpdateCartUseCase,
    (opts.complete ?? stubUseCase<CompleteOrderUseCase>()) as CompleteOrderUseCase,
    (opts.applyCoupon ?? stubUseCase<ApplyCouponUseCase>()) as ApplyCouponUseCase,
    (opts.payment ?? stubUseCase<CreatePaymentIntentUseCase>()) as CreatePaymentIntentUseCase,
    sessionRepo,
    opts.merchants ?? createMerchantRepo(),
    opts.variantLookup,
    opts.coupons,
    opts.merchantRules,
  );
  return { service, sessionRepo };
}

function stubUseCase<T>(): T {
  return {
    async execute() {
      return undefined;
    },
  } as unknown as T;
}

test("lifecycle: assertMutable rejects a completed session", async () => {
  const sessionRepo = createSessionRepo(["order_completed"]);
  const session = buildSession();
  await sessionRepo.saveSession(session);
  const { service } = buildService({ sessionRepo });
  const refreshed = buildSession();
  await assert.rejects(
    () => service.assertMutable(refreshed),
    (err: unknown) => err instanceof ConflictException,
  );
});

test("lifecycle: assertMutable rejects a canceled session", async () => {
  const sessionRepo = createSessionRepo(["checkout_abandoned"]);
  await sessionRepo.saveSession(buildSession());
  const { service } = buildService({ sessionRepo });
  const refreshed = buildSession();
  await assert.rejects(
    () => service.assertMutable(refreshed),
    (err: unknown) => err instanceof ConflictException,
  );
});

test("lifecycle: assertMutable allows a session in awaiting_payment state", async () => {
  const sessionRepo = createSessionRepo();
  await sessionRepo.saveSession(buildSession());
  const { service } = buildService({ sessionRepo });
  await service.assertMutable(buildSession());
});

test("lifecycle: completeSession rejects when token lacks payment:intents:confirm scope", async () => {
  const sessionRepo = createSessionRepo();
  await sessionRepo.saveSession(buildSession());
  const { service } = buildService({ sessionRepo });
  const claims = makeClaims(["checkout:start"]);

  await assert.rejects(
    () =>
      service.completeSession("mrc_test", "chk_test", claims, {
        payment_token: "aacp_embed_v1.payload.sig",
      }),
    (err: unknown) => {
      const e = err as { status: number; response: { code: string; missing_scopes: string[] } };
      return (
        err instanceof ForbiddenException &&
        e.status === 403 &&
        e.response.code === "token_scope_not_granted" &&
        e.response.missing_scopes.includes("payment:intents:confirm")
      );
    },
  );
});

test("lifecycle: completeSession rejects when cart is empty", async () => {
  const sessionRepo = createSessionRepo();
  await sessionRepo.saveSession(
    buildSession({ cart: { currency: "BRL", total: 0, items: [] } }),
  );
  const { service } = buildService({ sessionRepo });
  const claims = makeClaims(["payment:intents:confirm"]);

  await assert.rejects(
    () =>
      service.completeSession("mrc_test", "chk_test", claims, {
        payment_token: "tok",
      }),
    (err: unknown) => err instanceof BadRequestException,
  );
});

test("lifecycle: completeSession rejects when shipping not selected", async () => {
  const sessionRepo = createSessionRepo();
  await sessionRepo.saveSession(buildSession({ shipping: undefined }));
  const { service } = buildService({ sessionRepo });
  const claims = makeClaims(["payment:intents:confirm"]);

  await assert.rejects(
    () =>
      service.completeSession("mrc_test", "chk_test", claims, {
        payment_token: "tok",
      }),
    (err: unknown) => {
      if (!(err instanceof BadRequestException)) return false;
      const e = err as unknown as { message?: string; response?: { message?: string } };
      return e.message === "acp_shipping_required" || e.response?.message === "acp_shipping_required";
    },
  );
});

test("lifecycle: completeSession rejects a completed session (terminal)", async () => {
  const sessionRepo = createSessionRepo(["order_completed"]);
  await sessionRepo.saveSession(buildSession());
  const { service } = buildService({ sessionRepo });
  const claims = makeClaims(["payment:intents:confirm"]);

  await assert.rejects(
    () =>
      service.completeSession("mrc_test", "chk_test", claims, {
        payment_token: "tok",
      }),
    (err: unknown) => err instanceof ConflictException,
  );
});

test("lifecycle: completeSession happy path returns order_id and confirmation_url", async () => {
  const sessionRepo = createSessionRepo();
  await sessionRepo.saveSession(
    buildSession({
      shipping: { customerPrice: 20, carrier: "Correios", method: "PAC" },
    }),
  );
  const merchants = createMerchantRepo("test-store");
  const paymentIntent = {
    id: "intent_123",
    providerPaymentId: "pay_abc",
    amountCents: 20000,
    currency: "BRL",
    status: "pending",
  };
  const paymentStub = {
    async execute() {
      return paymentIntent;
    },
  } as unknown as CreatePaymentIntentUseCase;
  const completeStub = {
    async execute() {
      return { recorded: true, idempotent: false, event_type: "order.completed" as const };
    },
  } as unknown as CompleteOrderUseCase;
  const { service } = buildService({
    sessionRepo,
    merchants,
    payment: paymentStub,
    complete: completeStub,
  });

  const claims = makeClaims(["payment:intents:confirm"]);
  const result = await service.completeSession("mrc_test", "chk_test", claims, {
    payment_token: "tok",
  });

  assert.equal(result.order_id, "pay_abc");
  assert.equal(result.status, "completed");
  // Default store domain is zyon-payments.com.br; slug becomes subdomain.
  assert.equal(result.confirmation_url, "https://test-store.zyon-payments.com.br/orders/pay_abc");
});

test("lifecycle: confirmation_url falls back to merchantId when slug is missing", async () => {
  const sessionRepo = createSessionRepo();
  await sessionRepo.saveSession(
    buildSession({
      shipping: { customerPrice: 20, carrier: "Correios", method: "PAC" },
    }),
  );
  const merchants = createMerchantRepo();
  const paymentStub = {
    async execute() {
      return {
        id: "intent_x",
        providerPaymentId: null,
        amountCents: 100,
        currency: "BRL",
        status: "pending",
      };
    },
  } as unknown as CreatePaymentIntentUseCase;
  const completeStub = {
    async execute() {
      return { recorded: true, idempotent: false, event_type: "order.completed" as const };
    },
  } as unknown as CompleteOrderUseCase;
  const { service } = buildService({ sessionRepo, merchants, payment: paymentStub, complete: completeStub });

  const claims = makeClaims(["payment:intents:confirm"]);
  const result = await service.completeSession("mrc_test", "chk_test", claims, {
    payment_token: "tok",
  });

  assert.equal(result.order_id, "intent_x");
  // No slug → falls back to merchant id as subdomain.
  assert.equal(result.confirmation_url, "https://mrc_test.zyon-payments.com.br/orders/intent_x");
});

test("lifecycle: cancelSession records checkout_abandoned and returns status canceled", async () => {
  const sessionRepo = createSessionRepo();
  await sessionRepo.saveSession(buildSession());
  const { service } = buildService({ sessionRepo });

  const acp = await service.cancelSession("mrc_test", "chk_test");
  assert.equal(acp.status, "canceled");
  assert.equal(sessionRepo.recordedEvents.length, 1);
  assert.equal(sessionRepo.recordedEvents[0].event, "checkout_abandoned");
  const lastSaved = sessionRepo.savedSessions.at(-1);
  assert.equal(lastSaved?.cart.items.length, 0);
  assert.equal(lastSaved?.cart.total, 0);
  assert.equal(lastSaved?.shipping, undefined);
});

test("lifecycle: cancelSession rejects an already-canceled session (terminal)", async () => {
  const sessionRepo = createSessionRepo(["checkout_abandoned"]);
  await sessionRepo.saveSession(buildSession());
  const { service } = buildService({ sessionRepo });

  await assert.rejects(
    () => service.cancelSession("mrc_test", "chk_test"),
    (err: unknown) => err instanceof ConflictException,
  );
});

test("lifecycle: getSession returns derived status pending for fresh session", async () => {
  const sessionRepo = createSessionRepo();
  await sessionRepo.saveSession(buildSession({ shipping: undefined }));
  const { service } = buildService({ sessionRepo });
  const acp = await service.getSession("mrc_test", "chk_test");
  assert.equal(acp.status, "not_ready_for_payment");
});

test("lifecycle: getSession returns awaiting_payment when items + shipping + total > 0", async () => {
  const sessionRepo = createSessionRepo();
  await sessionRepo.saveSession(
    buildSession({
      shipping: { customerPrice: 20, carrier: "Correios", method: "PAC" },
    }),
  );
  const { service } = buildService({ sessionRepo });
  const acp = await service.getSession("mrc_test", "chk_test");
  assert.equal(acp.status, "ready_for_payment");
});

test("lifecycle: getSession returns completed when order_completed event present", async () => {
  const sessionRepo = createSessionRepo(["order_completed"]);
  await sessionRepo.saveSession(buildSession());
  const { service } = buildService({ sessionRepo });
  const acp = await service.getSession("mrc_test", "chk_test");
  assert.equal(acp.status, "completed");
});

test("lifecycle: updateSession rejects completed session (terminal)", async () => {
  const sessionRepo = createSessionRepo(["order_completed"]);
  await sessionRepo.saveSession(buildSession());
  const { service } = buildService({ sessionRepo });

  await assert.rejects(
    () =>
      service.updateSession("mrc_test", "chk_test", {
        line_items: [{ id: "sku_1", quantity: 1 }],
      }),
    (err: unknown) => err instanceof ConflictException,
  );
});

test("lifecycle: updateSession applies line_items via UpdateCartUseCase when SKUs are existing", async () => {
  const sessionRepo = createSessionRepo();
  await sessionRepo.saveSession(buildSession());

  const calls: unknown[] = [];
  const updateCartStub = {
    async execute(input: unknown) {
      calls.push(input);
      return { session_id: "chk_test", experience: undefined };
    },
  } as unknown as UpdateCartUseCase;

  const { service } = buildService({ sessionRepo, updateCart: updateCartStub });
  await service.updateSession("mrc_test", "chk_test", {
    line_items: [{ id: "sku_1", quantity: 3 }],
  });
  assert.equal(calls.length, 1);
  assert.deepEqual((calls[0] as { items: unknown[] }).items, [{ sku: "sku_1", quantity: 3 }]);
});
