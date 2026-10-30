import { test } from "node:test";
import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import { ShoppingAgentService } from "./application/shopping-agent.service.js";
import { ShoppingAgentWorker } from "./application/shopping-agent.worker.js";
import { ShoppingAgentController } from "./presentation/shopping-agent.controller.js";
import { freshState, validateConfig, validateSettings, inQuietHours, nextCycle, fingerprint, ShoppingError,
  type ShoppingRepository, type Workspace, type ShoppingState, type ShoppingQuote, type ShoppingTask } from "./domain/shopping-agent.js";

const now = new Date();
const config = (patch: Record<string, unknown> = {}) => ({ kind: "price_watch", title: "Meu café", items: [{ productId: "product", variantId: "variant", quantity: 2 }], targetCents: 2099, includeShipping: false, targetDiscountPercent: 0, ...patch });
class MemoryRepository implements ShoppingRepository {
  rows = new Map<string, Workspace>();
  conflictOnce = false;
  async find(buyerId: string, merchantId: string) { return structuredClone([...this.rows.values()].find(r => r.globalUserId === buyerId && r.merchantId === merchantId) ?? null); }
  async create(globalUserId: string, merchantId: string, state: ShoppingState) {
    const old = await this.find(globalUserId, merchantId); if (old) return old;
    const row: Workspace = { id: `${globalUserId}:${merchantId}`, globalUserId, merchantId, state: structuredClone(state), revision: 0, nextCheckAt: now, leaseId: null, leaseUntil: null };
    this.rows.set(row.id, row); return structuredClone(row);
  }
  async compareAndSwap(row: Workspace, state: ShoppingState, nextCheckAt: Date) {
    if (this.conflictOnce) { this.conflictOnce = false; this.rows.get(row.id)!.revision++; return false; }
    const saved = this.rows.get(row.id);
    if (!saved || saved.revision !== row.revision) return false;
    this.rows.set(row.id, { ...saved, state: structuredClone(state), revision: row.revision + 1, nextCheckAt }); return true;
  }
  async claimDue(date: Date, leaseId: string, limit: number) {
    const due = [...this.rows.values()].filter(row => row.nextCheckAt <= date && (!row.leaseUntil || row.leaseUntil < date)).slice(0, limit);
    for (const row of due) { row.leaseId = leaseId; row.leaseUntil = new Date(date.getTime() + 300_000); }
    return structuredClone(due);
  }
  async release(id: string, leaseId: string) { const row = this.rows.get(id)!; if (row.leaseId === leaseId) { row.leaseId = null; row.leaseUntil = null; } }
}
function fixture() {
  const repo = new MemoryRepository();
  let premium = true;
  let profile: any = null;
  let quotes = 0;
  let prepares = 0;
  let failure: Error | undefined;
  let duringQuote: (() => Promise<void>) | undefined;
  const quote: ShoppingQuote = { items: [{ productId: "product", variantId: "variant", quantity: 2, name: "Café", sku: "CAFE", unitPriceCents: 1000 }],
    subtotalCents: 2000, discountCents: 0, serviceFeeCents: 99, shippingCents: null, totalCents: 2099, currency: "BRL", available: true, discountPercent: 0, fingerprint: "initial", expiresAt: new Date(Date.now() + 600_000).toISOString() };
  const service = new ShoppingAgentService(repo, {
    async quote() { quotes++; if (duringQuote) { const action = duringQuote; duringQuote = undefined; await action(); } if (failure) throw failure; return structuredClone(quote); },
    async prepare() { prepares++; return { embedToken: "scoped-test-token", cartRef: "agent-purchase" }; },
  }, { async assertAllowed() { if (!premium) throw new ForbiddenException("premium_required"); } } as any,
  { async findByGlobalUserId() { return { globalUserId: "buyer", email: "buyer@example.test" }; }, async findAgentByGlobalUserId() { return profile; }, async saveAgent(value: unknown) { profile = value; } } as any);
  const sent: Array<{ channel: string; activity: { id: string } }> = [];
  const worker = new ShoppingAgentWorker(service, { async send(input) { sent.push(input); return { status: "sent", providerId: `provider-${sent.length}` }; } });
  const init = async (settings: Record<string, unknown> = {}) => {
    await repo.create("buyer", "merchant", freshState(validateSettings({ accepted: true, quietStart: 0, quietEnd: 0, ...settings }, undefined, now)));
  };
  const task = async (patch: Record<string, unknown> = {}, key = "request-key-001") => service.createTask("buyer", "merchant", config(patch), key, now);
  const process = async (date = now) => worker.process((await repo.find("buyer", "merchant"))!, date);
  const state = async () => (await repo.find("buyer", "merchant"))!.state;
  return { repo, service, worker, quote, sent, init, task, process, state,
    setPremium: (value: boolean) => { premium = value; }, setFailure: (value: Error) => { failure = value; }, duringQuote: (action: () => Promise<void>) => { duringQuote = action; },
    calls: () => ({ quotes, prepares }) };
}
function code(expected: string) { return (error: unknown) => error instanceof ShoppingError && error.code === expected; }

test("creation requires separate agent consent and channels default to off", () => {
  assert.throws(() => validateSettings({}), code("agent_consent_required"));
  const settings = validateSettings({ accepted: true }, undefined, now);
  assert.equal(settings.email, false); assert.equal(settings.whatsapp, false); assert.equal(settings.enabled, true);
});

test("JSON object ordering does not change an idempotency fingerprint", () => {
  assert.equal(fingerprint({ kind: "price_watch", items: [{ productId: "p", variantId: "v", quantity: 1 }] }),
    fingerprint({ items: [{ quantity: 1, variantId: "v", productId: "p" }], kind: "price_watch" }));
  assert.notEqual(fingerprint(["p", "v"]), fingerprint(["v", "p"]));
});

test("appearance has a compatible default and rejects arbitrary assets, colors and versions", () => {
  const settings = validateSettings({ accepted: true });
  assert.deepEqual(settings.appearance, { version: 1, style: "aura", color: "jade", expression: "friendly" });
  for (const appearance of [null, [], { version: 2, style: "aura", color: "jade", expression: "friendly" },
    { version: 1, style: "aura", color: "url(https://example.invalid)", expression: "friendly" },
    { version: 1, style: "aura", color: "jade", expression: "friendly", imageUrl: "https://example.invalid/image.svg" }]) {
    assert.throws(() => validateSettings({ accepted: true, appearance }), code("agent_invalid_appearance"));
  }
});

test("saving appearance persists for this buyer and store without changing channel consent", async () => {
  const f = fixture(); await f.init({ email: true });
  const appearance = { version: 1, style: "orbit", color: "lilac", expression: "happy" };
  await f.service.configure("buyer", "merchant", { name: "Nina", appearance });
  const view = await f.service.get("buyer", "merchant");
  assert.deepEqual(view.state?.settings.appearance, appearance); assert.equal(view.profile?.name, "Nina");
  assert.equal(view.state?.settings.email, true); assert.equal(view.state?.settings.whatsapp, false);
  await f.service.configure("buyer", "merchant", { email: false });
  assert.deepEqual((await f.service.get("buyer", "merchant")).state?.settings.appearance, appearance);
  assert.equal((await f.service.get("other", "merchant")).state, null);
  assert.equal((await f.service.get("buyer", "other")).state, null);
});

test("a downgrade blocks changing appearance but still allows pausing and opt-out", async () => {
  const f = fixture(); await f.init({ email: true }); f.setPremium(false);
  await assert.rejects(() => f.service.configure("buyer", "merchant", { appearance: { version: 1, style: "visor", color: "rose", expression: "focused" } }), code("agent_premium_required"));
  await f.service.configure("buyer", "merchant", { enabled: false, email: false });
  assert.equal((await f.state()).settings.enabled, false);
});
test("configuration rejects coercion, invalid dates, duplicate variants and unsupported kinds", () => {
  for (const patch of [{ items: [{ productId: "p", variantId: "v", quantity: "2" }] }, { items: [...config().items, ...config().items] }, { targetCents: -1 }, { targetCents: 12.3 }, { expiresAt: "yesterday" }, { kind: "automatic_payment" }, { includeShipping: "false" }]) assert.throws(() => validateConfig(config(patch), now));
});
test("a shipping-inclusive task requires a real destination and deadline validation", () => {
  assert.throws(() => validateConfig(config({ includeShipping: true }), now), code("agent_destination_required"));
  assert.throws(() => validateConfig(config({ maxDeliveryDays: 2 }), now), code("agent_shipping_required_for_deadline"));
  assert.equal(validateConfig(config({ includeShipping: true, destinationZip: "01310-100" }), now).destinationZip, "01310100");
});
test("quiet hours respect buyer timezone and cross midnight", () => {
  const settings = validateSettings({ accepted: true }, undefined, now);
  assert.equal(inQuietHours(settings, new Date("2026-10-28T02:00:00Z")), true);
  assert.equal(inQuietHours(settings, now), false);
  assert.throws(() => validateSettings({ accepted: true, timeZone: "Invalid/Zone" }), code("agent_invalid_timezone"));
});
test("a delayed recurring job advances to one future cycle without a backlog of purchases", () => {
  const task = { createdAt: "2026-01-01T15:00:00Z", config: { intervalDays: 30 } } as ShoppingTask;
  assert.equal(nextCycle(task, new Date("2026-04-10T15:00:00Z")), "2026-05-01T15:00:00.000Z");
});

test("a task expires on its deadline even when its recurring date is later", async () => {
  const f = fixture(); await f.init();
  await f.task({ kind: "reorder", intervalDays: 30, expiresAt: new Date(now.getTime() + 86_400_000).toISOString() });
  assert.equal((await f.repo.find("buyer", "merchant"))!.nextCheckAt.toISOString(), new Date(now.getTime() + 86_400_000).toISOString());
  await f.process(new Date(now.getTime() + 86_400_000));
  assert.equal((await f.state()).tasks[0]!.status, "expired"); assert.equal((await f.state()).activities.length, 0);
});
test("creating an agent preserves an existing global agent profile", async () => {
  const f = fixture(); await f.service.configure("buyer", "merchant", { name: "Lia", accepted: true });
  const view = await f.service.get("buyer", "merchant"); assert.equal(view.profile?.name, "Lia"); assert.equal(view.state?.settings.email, false);
});
test("the premium gate blocks creation but preserves read access and opt-out", async () => {
  const f = fixture(); await f.init({ email: true }); f.setPremium(false);
  await assert.rejects(() => f.task(), code("agent_premium_required"));
  const view = await f.service.configure("buyer", "merchant", { enabled: false, email: false });
  assert.equal(view.premium, false); assert.equal(view.state?.settings.enabled, false);
});
test("a repeated request creates one task and a different payload cannot reuse its key", async () => {
  const f = fixture(); await f.init(); const first = await f.task(); const repeated = await f.task();
  assert.equal(first.id, repeated.id); assert.equal((await f.state()).tasks.length, 1);
  await assert.rejects(() => f.task({ title: "Outra compra" }), code("agent_idempotency_conflict"));
});
test("optimistic conflicts retry without losing or duplicating a new task", async () => {
  const f = fixture(); await f.init(); f.repo.conflictOnce = true; await f.task(); assert.equal((await f.state()).tasks.length, 1);
});
test("a match at the exact budget threshold generates one approval and no purchase", async () => {
  const f = fixture(); await f.init(); await f.task(); await f.process();
  const state = await f.state(); assert.equal(state.activities.length, 1); assert.equal(state.activities[0]?.decision, "pending"); assert.equal(f.calls().prepares, 0);
});
test("a repeated unchanged match does not repeat the activity or notification", async () => {
  const f = fixture(); await f.init({ email: true }); await f.task(); await f.process(); await f.process(new Date(now.getTime() + 900_000));
  assert.equal((await f.state()).activities.length, 1); assert.equal(f.sent.length, 1);
});
test("an over-budget item never generates a purchasable opportunity", async () => {
  const f = fixture(); await f.init(); await f.task({ targetCents: 2098 }); await f.process(); assert.equal((await f.state()).activities.length, 0);
});
test("restock monitoring only triggers when the requested quantity becomes available", async () => {
  const f = fixture(); await f.init(); f.quote.available = false; await f.task({ kind: "restock" }); await f.process();
  assert.equal((await f.state()).activities.length, 0); f.quote.available = true;
  await f.process(new Date(now.getTime() + 900_000)); assert.equal((await f.state()).activities.length, 1);
});
test("a recurring purchase waits for its due date and generates an approval once per cycle", async () => {
  const f = fixture(); await f.init(); await f.task({ kind: "reorder", intervalDays: 30 }); await f.process(); assert.equal((await f.state()).activities.length, 0);
  const due = new Date(now.getTime() + 30 * 86_400_000); await f.process(due); await f.process(due);
  assert.equal((await f.state()).activities.length, 1); assert.equal(f.calls().prepares, 0);
});
test("out-of-stock and over-budget recurring cycles produce an explanation without buying", async () => {
  for (const available of [true, false]) {
    const f = fixture(); await f.init(); f.quote.available = available; await f.task({ kind: "reorder", intervalDays: 1, targetCents: 1000 }); await f.process(new Date(now.getTime() + 86_400_000));
    const activity = (await f.state()).activities[0]!; assert.equal(activity.decision, "dismissed"); assert.equal(activity.kind, available ? "over_budget" : "unavailable");
  }
});
test("negotiation requires an authorized discount and never invents a deal", async () => {
  const f = fixture(); await f.init(); await f.task({ kind: "negotiate", targetDiscountPercent: 10 }); await f.process();
  assert.equal((await f.state()).activities.length, 0);
  f.quote.discountPercent = 5; f.quote.fingerprint = "smaller-discount"; await f.process(new Date(now.getTime() + 900_000)); assert.equal((await f.state()).activities.length, 0);
  f.quote.discountPercent = 10; f.quote.fingerprint = "approved-discount"; await f.process(new Date(now.getTime() + 1_800_000)); assert.equal((await f.state()).activities.length, 1);
});
test("basket monitoring compares the total, including fees and optional shipping", async () => {
  const f = fixture(); await f.init(); f.quote.totalCents = 3099; f.quote.shippingCents = 1000;
  await f.task({ kind: "basket_budget", targetCents: 3000, includeShipping: true, destinationZip: "01310100" }); await f.process(); assert.equal((await f.state()).activities.length, 0);
});
test("pausing while a quote is in flight discards the late result", async () => {
  const f = fixture(); await f.init(); const task = await f.task(); f.duringQuote(async () => { await f.service.changeTask("buyer", "merchant", task.id, { action: "pause", revision: task.revision }, now); });
  await f.process(); assert.equal((await f.state()).activities.length, 0); assert.equal((await f.state()).tasks[0]?.status, "paused");
});
test("revoking the agent stops pending approvals and channel sends", async () => {
  const f = fixture(); await f.init({ email: true, quietStart: 0, quietEnd: 23 }); await f.task(); await f.process(); assert.equal(f.sent.length, 0);
  await f.service.configure("buyer", "merchant", { enabled: false }); await f.process(); assert.equal(f.sent.length, 0); assert.equal((await f.state()).activities[0]?.decision, "dismissed");
});
test("task revision protects against an outdated edit", async () => {
  const f = fixture(); await f.init(); const task = await f.task(); await f.service.changeTask("buyer", "merchant", task.id, { action: "pause", revision: task.revision }, now);
  await assert.rejects(() => f.service.changeTask("buyer", "merchant", task.id, { action: "resume", revision: task.revision }, now), code("agent_task_changed"));
});
test("skipping a recurring cycle invalidates its prior approval", async () => {
  const f = fixture(); await f.init(); const task = await f.task({ kind: "reorder", intervalDays: 1 }); await f.process(new Date(now.getTime() + 86_400_000));
  await f.service.changeTask("buyer", "merchant", task.id, { action: "skip", revision: task.revision }, new Date(now.getTime() + 86_400_000));
  assert.equal((await f.state()).activities[0]?.decision, "dismissed");
  assert.equal((await f.state()).tasks[0]?.nextRunAt, new Date(now.getTime() + 2 * 86_400_000).toISOString());
});

test("skipping before the due date skips the next scheduled recurring purchase", async () => {
  const f = fixture(); await f.init(); const task = await f.task({ kind: "reorder", intervalDays: 30 });
  await f.service.changeTask("buyer", "merchant", task.id, { action: "skip", revision: task.revision }, now);
  assert.equal((await f.state()).tasks[0]?.nextRunAt, new Date(now.getTime() + 60 * 86_400_000).toISOString());
  await f.process(new Date(now.getTime() + 30 * 86_400_000)); assert.equal((await f.state()).activities.length, 0);
});

test("resuming a recurring task preserves its future due date", async () => {
  const f = fixture(); await f.init(); const task = await f.task({ kind: "reorder", intervalDays: 30 });
  await f.service.changeTask("buyer", "merchant", task.id, { action: "pause", revision: 1 }, now);
  await f.service.changeTask("buyer", "merchant", task.id, { action: "resume", revision: 2 }, new Date(now.getTime() + 86_400_000));
  assert.equal((await f.state()).tasks[0]?.nextRunAt, task.nextRunAt);
});

test("editing a recurring interval schedules the first revised cycle after that interval", async () => {
  const f = fixture(); await f.init(); const task = await f.task({ kind: "reorder", intervalDays: 30 });
  const later = new Date(now.getTime() + 86_400_000);
  await f.service.changeTask("buyer", "merchant", task.id, { action: "update", revision: 1, config: config({ kind: "reorder", intervalDays: 7 }) }, later);
  assert.equal((await f.state()).tasks[0]?.nextRunAt, new Date(later.getTime() + 7 * 86_400_000).toISOString());
});
test("a price change after approval blocks handoff", async () => {
  const f = fixture(); await f.init(); await f.task(); await f.process(); const activity = (await f.state()).activities[0]!;
  f.quote.fingerprint = "new-price";
  await assert.rejects(() => f.service.decide("buyer", "merchant", activity.id, "checkout", "https://store.example"), code("agent_quote_changed")); assert.equal(f.calls().prepares, 0);
});
test("an expired historical quote is freshly revalidated before opening checkout", async () => {
  const f = fixture(); await f.init(); await f.task(); await f.process();
  await f.service.mutate("buyer", "merchant", state => { state.activities[0]!.quote!.expiresAt = "2020-01-01T00:00:00Z"; });
  const activity = (await f.state()).activities[0]!; const result = await f.service.decide("buyer", "merchant", activity.id, "checkout", "https://store.example");
  assert.equal(result.cartRef, "agent-purchase"); assert.equal(f.calls().prepares, 1);
});
test("a different buyer or merchant cannot read or approve another activity", async () => {
  const f = fixture(); await f.init(); await f.task(); await f.process(); const id = (await f.state()).activities[0]!.id;
  await assert.rejects(() => f.service.decide("other", "merchant", id, "checkout", "https://store.example"), code("agent_activity_not_found"));
  await assert.rejects(() => f.service.decide("buyer", "other", id, "checkout", "https://store.example"), code("agent_activity_not_found"));
  assert.equal((await f.service.get("other", "merchant")).state, null);
});
test("merchant-bound buyer tokens cannot select another merchant in the route", async () => {
  const f = fixture(); const controller = new ShoppingAgentController(f.service, {} as any, {} as any);
  assert.throws(() => controller.get({ user: { globalUserId: "buyer", merchantId: "merchant" }, headers: {} }, "other"), code("agent_not_found"));
});
test("a downgrade suppresses a queued send and records the premium pause", async () => {
  const f = fixture(); await f.init({ email: true, quietStart: 0, quietEnd: 23 }); await f.task(); await f.process(); f.setPremium(false); await f.process(new Date(now.getTime() + 86_400_000));
  assert.equal(f.sent.length, 0); assert.equal((await f.state()).tasks[0]?.lastOutcome, "premium_required");
});
test("provider uncertainty is recorded without retrying or switching channels", async () => {
  const f = fixture(); await f.init({ email: true }); await f.task();
  let attempts = 0; const worker = new ShoppingAgentWorker(f.service, { async send() { attempts++; throw new Error("timeout_after_dispatch"); } });
  await worker.process((await f.repo.find("buyer", "merchant"))!, now); await worker.process((await f.repo.find("buyer", "merchant"))!, new Date(now.getTime() + 900_000));
  assert.equal(attempts, 1); assert.equal((await f.state()).activities[0]?.deliveries.email?.status, "uncertain");
});
test("daily notification limits count opportunities across channels", async () => {
  const f = fixture(); await f.init({ email: true, whatsapp: true, maxDailyNotifications: 1 }); await f.task(); await f.task({ title: "Segundo café" }, "request-key-002"); await f.process();
  assert.equal(new Set(f.sent.map(s => s.activity.id)).size, 1); assert.equal(f.sent.length, 2);
});
test("a provider error backs off without a purchase or a fabricated result", async () => {
  const f = fixture(); await f.init(); await f.task(); f.setFailure(new Error("provider_down")); await f.process();
  const state = await f.state(); assert.equal(state.activities.length, 0); assert.equal(state.tasks[0]?.failures, 1); assert.ok(Date.parse(state.tasks[0]!.nextRunAt) > now.getTime());
});
test("checking again explicitly rearms a dismissed opportunity", async () => {
  const f = fixture(); await f.init(); const task = await f.task(); await f.process();
  await f.service.decide("buyer", "merchant", (await f.state()).activities[0]!.id, "dismiss", "");
  const later = new Date(now.getTime() + 600_000); await f.service.changeTask("buyer", "merchant", task.id, { action: "check", revision: task.revision }, later); await f.process(later);
  assert.equal((await f.state()).activities.filter(a => a.decision === "pending").length, 1);
});

test("two workers cannot generate two approvals for the same recurring cycle", async () => {
  const f = fixture(); await f.init({ email: true }); await f.task({ kind: "reorder", intervalDays: 1 });
  const date = new Date(now.getTime() + 86_400_000);
  await Promise.all([f.process(date), f.process(date)]);
  assert.equal((await f.state()).activities.length, 1);
  assert.equal(f.sent.length, 1);
});

test("a stale notification claim never dispatches twice after an optimistic conflict", async () => {
  const f = fixture(); await f.init({ email: true, quietStart: 0, quietEnd: 23 }); await f.task(); await f.process();
  await f.service.mutate("buyer", "merchant", state => { state.settings.quietStart = 0; state.settings.quietEnd = 0; });
  const workspace = (await f.repo.find("buyer", "merchant"))!;
  await Promise.all([f.worker.deliver(workspace, now), f.worker.deliver(workspace, now)]);
  assert.equal(f.sent.length, 1);
});

test("a crashed send becomes uncertain promptly and is never dispatched again", async () => {
  const f = fixture(); await f.init({ email: true, quietStart: 0, quietEnd: 23 }); await f.task(); await f.process();
  await f.service.mutate("buyer", "merchant", state => {
    state.tasks[0]!.status = "paused";
    state.activities[0]!.deliveries.email = { status: "sending", attemptedAt: now.toISOString() };
  }, now);
  assert.ok((await f.repo.find("buyer", "merchant"))!.nextCheckAt.getTime() <= now.getTime() + 60_000);
  await f.process(new Date(now.getTime() + 360_000));
  assert.equal((await f.state()).activities[0]!.deliveries.email?.status, "uncertain"); assert.equal(f.sent.length, 0);
});

test("revoking the agent still reconciles an interrupted dispatch without sending again", async () => {
  const f = fixture(); await f.init({ email: true, quietStart: 0, quietEnd: 23 }); await f.task(); await f.process();
  await f.service.mutate("buyer", "merchant", state => {
    state.activities[0]!.deliveries.email = { status: "sending", attemptedAt: now.toISOString() };
    state.settings.enabled = false;
  }, now);
  assert.ok((await f.repo.find("buyer", "merchant"))!.nextCheckAt.getTime() <= now.getTime() + 60_000);
  await f.process(new Date(now.getTime() + 360_000));
  assert.equal((await f.state()).activities[0]!.deliveries.email?.status, "uncertain"); assert.equal(f.sent.length, 0);
});
