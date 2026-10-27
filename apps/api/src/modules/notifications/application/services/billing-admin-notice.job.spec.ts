import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { BillingAdminNoticeJob, renderBillingAdminNotice } from "./billing-admin-notice.job.js";
import { EmailProviderRejection } from "../../domain/ports/email-provider-rejection.js";
import { PrismaBillingAdminNoticePublisher } from "../../../payment/infrastructure/prisma-billing-admin-notice.publisher.js";
import { HandleStripeWebhookUseCase } from "../../../payment/application/handle-stripe-webhook.use-case.js";

const notice = () => ({ id: "stripe:sub_fixture", provider: "stripe", subscriptionId: "sub_fixture", invoiceId: "in_fixture", eventId: "evt_fixture", merchantId: "merchant_fixture",
  planKey: "starter179", billingCycle: "monthly", amountPaidCents: 100, discountCents: 17800, currency: "BRL", occurredAt: new Date("2026-10-15T15:00:00Z"),
  status: "pending", attempts: 0, nextAttemptAt: new Date(0), lockedUntil: null, claimToken: null, providerMessageId: null, lastErrorCode: null, createdAt: new Date(0), updatedAt: new Date(0) });

function harness(send: (input: any) => Promise<any> = async () => ({ status: "sent", messageId: "email_accepted" }), admins = ["admin@example.test"]) {
  const state: any = notice(); const messages: any[] = [];
  const matches = (where: any) => Object.entries(where).every(([key, value]: any) => {
    if (value && typeof value === "object") {
      if (value.in) return value.in.includes(state[key]);
      if (value.lte) return state[key] !== null && state[key] <= value.lte;
      if (value.gt) return state[key] !== null && state[key] > value.gt;
    }
    return state[key] === value;
  });
  const repository = {
    updateMany: async ({ where, data }: any) => { if (!matches(where)) return { count: 0 }; Object.assign(state, data); return { count: 1 }; },
    update: async ({ data }: any) => { Object.assign(state, { ...data, attempts: state.attempts + 1 }); return { ...state }; },
  };
  const prisma: any = { billingAdminNotice: repository,
    platformOperator: { findMany: async () => admins.map(email => ({ email })) },
    merchant: { findUnique: async () => ({ name: "Loja & Teste", users: [{ email: "owner@example.test" }] }) },
    $queryRaw: async () => state.status === "pending" && state.nextAttemptAt <= new Date() ? [{ id: state.id }] : [],
  };
  prisma.$transaction = async (callback: any) => callback(prisma);
  const job = new BillingAdminNoticeJob(prisma, { send: async input => { messages.push(input); return send(input); } });
  return { state, prisma, job, messages };
}

test("admin email: provider acceptance, actual discounted amount, stable key and no resend", async () => {
  const h = harness(); await h.job.runOnce(); await h.job.runOnce();
  assert.equal(h.state.status, "sent"); assert.equal(h.state.providerMessageId, "email_accepted"); assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].requireDelivery, true); assert.equal(h.messages[0].idempotencyKey, "billing-admin:stripe:sub_fixture");
  assert.equal(h.messages[0].to, "admin@example.test"); assert.match(h.messages[0].html, /1,00/); assert.match(h.messages[0].html, /178,00/);
  assert.match(h.messages[0].html, /owner@example.test/); assert.match(h.messages[0].subject, /Nova assinatura Starter confirmada/);
});

test("admin email: missing/ambiguous recipient never sends", async () => {
  for (const admins of [[], ["admin1@example.test", "admin2@example.test"]]) {
    const h = harness(undefined, admins); await h.job.runOnce(); assert.equal(h.messages.length, 0);
    assert.equal(h.state.status, "pending"); assert.equal(h.state.lastErrorCode, "admin_recipient_not_configured");
  }
});

test("admin email: skipped provider is pending, never delivered", async () => {
  const h = harness(async () => ({ status: "skipped", messageId: "" })); await h.job.runOnce();
  assert.equal(h.state.status, "pending"); assert.equal(h.state.providerMessageId, null); assert.equal(h.messages.length, 1);
});

test("admin email: unknown transport and missing message id require reconciliation, not duplicate sends", async () => {
  for (const send of [async () => { throw new Error("timeout"); }, async () => ({ status: "sent", messageId: "" })]) {
    const h = harness(send); await h.job.runOnce(); await h.job.runOnce();
    assert.equal(h.state.status, "unknown"); assert.equal(h.messages.length, 1);
  }
});

test("admin email: safe rejected requests retry; permanent rejection fails", async () => {
  for (const retryable of [true, false]) {
    const h = harness(async () => { throw new EmailProviderRejection("fixture", retryable, "fixture"); });
    await h.job.runOnce(); assert.equal(h.state.status, retryable ? "pending" : "failed"); assert.equal(h.state.providerMessageId, null);
  }
});

test("admin email: stale preparation can retry; stale dispatch remains unknown", async () => {
  for (const status of ["preparing", "sending"]) {
    const h = harness(); Object.assign(h.state, { status, lockedUntil: new Date(0), claimToken: "expired" });
    await h.job.runOnce(); assert.equal(h.state.status, status === "sending" ? "unknown" : "sent");
    assert.equal(h.messages.length, status === "sending" ? 0 : 1);
  }
});

test("admin email: preparation errors retry safely and exhausted retries fail", async () => {
  const h = harness(); h.prisma.merchant.findUnique = async () => { throw new Error("db unavailable"); };
  h.state.attempts = 11; await h.job.runOnce(); assert.equal(h.messages.length, 0); assert.equal(h.state.status, "failed");
});

test("admin email: HTML escapes customer content and rejects unsafe admin URLs", () => {
  const previous = process.env.PLATFORM_CONTROL_PUBLIC_URL; process.env.PLATFORM_CONTROL_PUBLIC_URL = "javascript:alert(1)";
  try {
    const content = renderBillingAdminNotice(notice(), '<script>alert("x")</script>', "owner&test@example.test");
    assert.doesNotMatch(content.html, /<script>|javascript:/); assert.match(content.html, /&lt;script&gt;/);
    assert.match(content.html, /owner&amp;test/); assert.match(content.html, /https:\/\/zyon-control.vercel.app/);
  } finally { if (previous === undefined) delete process.env.PLATFORM_CONTROL_PUBLIC_URL; else process.env.PLATFORM_CONTROL_PUBLIC_URL = previous; }
});

test("admin email: publisher upsert deduplicates separate deliveries for one subscription", async () => {
  const rows = new Map(); let calls = 0;
  const publisher = new PrismaBillingAdminNoticePublisher({ billingAdminNotice: { upsert: async (input: any) => {
    calls++; const key = input.where.provider_subscriptionId.subscriptionId; if (!rows.has(key)) rows.set(key, input.create); return rows.get(key);
  } } } as any);
  const { occurredAt, ...input } = notice();
  await publisher.enqueue({ ...input, occurredAt: occurredAt.toISOString() } as any);
  await publisher.enqueue({ ...input, eventId: "evt_second_delivery", occurredAt: occurredAt.toISOString() } as any);
  assert.equal(calls, 2); assert.equal(rows.size, 1); assert.equal(rows.get("sub_fixture").eventId, "evt_fixture");
});

function webhookHarness(subscription: Record<string, any> = {}) {
  const queued: any[] = []; const seen = new Set<string>(); const current = { subscriptionId: "sub_fixture", merchantId: "merchant_fixture", priceId: "starter179", status: "active", billingCycle: "monthly", ...subscription };
  const payments: any = { recordProcessedProviderEvent: async ({ eventId }: any) => { if (seen.has(eventId)) return false; seen.add(eventId); return true; },
    deleteProcessedProviderEvent: async ({ eventId }: any) => { seen.delete(eventId); } };
  const useCase = new HandleStripeWebhookUseCase(payments, {} as any, undefined, { subscriptionUpdated: async () => {} } as any,
    undefined, undefined, { retrieveBillingSubscription: async () => current } as any, undefined, undefined, undefined,
    { enqueue: async input => { queued.push(input); } });
  const event = (extra: any = {}, invoiceExtra: any = {}) => ({ id: "evt_fixture", type: "invoice.paid", created: 1792076400, livemode: false,
    data: { object: { id: "in_fixture", status: "paid", billing_reason: "subscription_create", parent: { subscription_details: { subscription: "sub_fixture" } },
      amount_paid: 100, total_discount_amounts: [{ amount: 17800 }], currency: "brl", ...invoiceExtra } }, ...extra } as any);
  return { queued, useCase, event };
}

test("subscription webhook: only confirmed initial paid subscription queues admin notice", async () => {
  const h = webhookHarness(); const event = h.event();
  assert.equal((await h.useCase.dispatchEvent(event)).outcome, "processed");
  assert.equal((await h.useCase.dispatchEvent(event)).outcome, "duplicate"); assert.equal(h.queued.length, 1);
  assert.equal(h.queued[0].amountPaidCents, 100); assert.equal(h.queued[0].discountCents, 17800); assert.equal(h.queued[0].currency, "BRL");
});

test("subscription webhook: no notice on renewal, failure, Connect, non-paid invoice or unrelated subscription", async () => {
  for (const [eventExtra, invoiceExtra] of [ [{ type: "invoice.payment_failed" }, {}], [{}, { billing_reason: "subscription_cycle" }],
    [{ account: "acct_connected" }, {}], [{}, { status: "open" }], [{}, { parent: null }] ]) {
    const h = webhookHarness(); await h.useCase.dispatchEvent(h.event(eventExtra, invoiceExtra)); assert.equal(h.queued.length, 0);
  }
  for (const snapshot of [{ status: "trialing" }, { priceId: "starter" }, { merchantId: null }, { subscriptionId: "sub_other" }, { priceId: "price_unrecognized" }]) {
    const h = webhookHarness(snapshot); await h.useCase.dispatchEvent(h.event()); assert.equal(h.queued.length, 0);
  }
});
