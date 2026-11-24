import assert from "node:assert/strict";
import { AsaasPaymentAdapter } from "../src/modules/payment/infrastructure/asaas-payment.adapter.js";
import { RoutingPaymentAdapter } from "../src/modules/payment/infrastructure/routing-payment.adapter.js";
import type { CreateProviderPaymentInput } from "../src/modules/payment/domain/ports/payment-provider.port.js";

// Captured transport only. Never installs global fetch or contacts an Asaas
// endpoint. The actual router/strict adapter classify every supplied body.
export function ownedAsaasCancellation(scope: { merchantId: string; sessionId: string; intentId: string }, method: "card" | "pix", rotated = false) {
  const base = "https://api-sandbox.asaas.com", key = "synthetic-owned-key", providerId = "pay_owned_" + scope.intentId;
  const calls: Array<{ method: string; url: string }> = [], responses: Array<{ body: unknown; status: number }> = [];
  const state = { beforeCall: undefined as (() => Promise<void>) | undefined };
  const captured: typeof fetch = async (url, init) => {
    const target = String(url), verb = init?.method ?? "GET";
    assert.equal(target, base + "/v3/payments/" + encodeURIComponent(providerId)); assert.ok(["GET", "DELETE"].includes(verb), "captured cancellation cannot create/refund a payment");
    calls.push({ method: verb, url: target }); await state.beforeCall?.();
    const next = responses.shift(); assert.ok(next, "explicit captured response required"); return Response.json(next.body, { status: next.status });
  };
  const original = new AsaasPaymentAdapter(base, key, captured), adapter = rotated ? new AsaasPaymentAdapter(base, "synthetic-rotated-key", captured) : original;
  const router = new RoutingPaymentAdapter(null, adapter, null, {} as never);
  const input: CreateProviderPaymentInput = { ...scope, provider: "asaas", providerAccountFingerprint: original.creationAccountFingerprint(), method,
    amountCents: 5000, currency: "BRL", asaasCustomerId: "cus_owned", settlementMode: "immediate_split" };
  const body = (overrides: Record<string, unknown> = {}) => ({ id: providerId, externalReference: scope.intentId, customer: "cus_owned",
    billingType: method === "card" ? "CREDIT_CARD" : "PIX", value: 50, currency: "BRL", deleted: false, status: "PENDING", subscription: null, installment: null, ...overrides });
  return { adapter, router, input, providerId, calls, state, body,
    enqueue(value: unknown, status = 200) { responses.push({ body: value, status }); },
    success() { responses.push({ body: body(), status: 200 }, { body: body(), status: 200 }, { body: { id: providerId, deleted: true }, status: 200 }, { body: body({ deleted: true }), status: 200 }); } };
}
