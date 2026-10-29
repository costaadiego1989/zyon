import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { CheckoutSession } from "@zyon/shared-types";
import { checkoutSession, merchantRules } from "../../__tests__/checkout-test-fixtures.js";
import { PrismaCheckoutRepository } from "./prisma-checkout.repository.js";
import { toCheckoutSession } from "./checkout-session.mapper.js";
import { CheckoutBootstrapService } from "../../application/services/checkout-bootstrap.service.js";

type Row = Parameters<typeof toCheckoutSession>[0] & { version: number };
type Entry = { kind: string; tx: boolean; sql?: string; values?: unknown[] };
const merchantId = "anchor-synthetic-merchant", sessionId = "anchor-synthetic-session";
function session(): CheckoutSession {
  return checkoutSession({ merchantId, sessionId, persistenceVersion: 1, cohort: "holdout" });
}
function row(value = session()): Row {
  return { ...value, customer: value.customer ?? null, shipping: value.shipping ?? null,
    version: value.persistenceVersion ?? 1, createdAt: new Date(value.createdAt), updatedAt: new Date(value.updatedAt) };
}
function harness(initial: Row | null = row(), options: { anchorError?: Error; upsertError?: Error; commitError?: Error } = {}) {
  let stored = initial ?? undefined, active = false, transactions = 0;
  const trace: Entry[] = [];
  const note = (kind: string) => trace.push({ kind, tx: active });
  const update = (data: Partial<Row>) => {
    stored = { ...(stored ?? row()), ...data, version: (stored?.version ?? 0) + 1 };
    return stored;
  };
  const tx = {
    async $queryRaw(sql: TemplateStringsArray, ...values: unknown[]) {
      const text = sql.join("?"); trace.push({ kind: "sql", sql: text, values, tx: active });
      if (text.includes("pg_advisory_xact_lock") && options.anchorError) throw options.anchorError;
      return text.includes("clock_timestamp") ? [{ now: new Date("2026-10-19T12:00:00Z") }] : [];
    },
    checkoutSession: {
      async findUnique() { note("checkout.read"); return stored ?? null; },
      async create(input: { data: Partial<Row> }) { note("checkout.create"); return update(input.data); },
      async update(input: { data: Partial<Row> }) { note("checkout.update"); return update(input.data); },
      async updateMany(input: { data: Partial<Row>; where: { version?: number } }) {
        note("checkout.cas"); assert.equal(input.where.version, stored?.version); update(input.data); return { count: 1 };
      },
      async upsert(input: { update: Record<string, unknown>; create: Partial<Row> }) {
        note("checkout.upsert"); assert.deepEqual(input.update, {});
        if (options.upsertError) { stored = row(); throw options.upsertError; }
        return stored ?? update(input.create);
      },
    },
    strategyAssignment: { async findUnique() { return null; } },
    strategyIncentiveAssignment: { async findUnique() { return null; } },
    checkoutChatRequest: { async findFirst() { return null; } },
    paymentIntent: { async findFirst() { return null; } },
    completedOrder: { async findFirst() { return null; } },
    checkoutEvent: { async findFirst() { return null; }, async create() { note("event.create"); return {}; } },
    couponRedemption: { async updateMany() { note("coupon.cancel"); return { count: 0 }; } },
    merchantRule: { async upsert() { return merchantRules(); } },
    outboxMessage:{async upsert(){note("outbox.append");return {};}},
  };
  const prisma = { ...tx, async $transaction<T>(work: (value: typeof tx) => Promise<T>): Promise<T> {
    assert.equal(active, false, "nested repository calls must reuse the transaction");
    transactions++; active = true;
    try { const result = await work(tx); if (options.commitError) throw options.commitError; return result; }
    finally { active = false; }
  } };
  return { repo: new PrismaCheckoutRepository(prisma as unknown as PrismaClient), trace,
    transactions: () => transactions, stored: () => stored };
}
function assertAnchor(trace: Entry[]) {
  const anchor = trace.findIndex(entry => entry.sql?.includes("pg_advisory_xact_lock"));
  assert.ok(anchor >= 0, "transaction-scoped session anchor must be acquired");
  assert.match(trace[anchor]!.sql!, /hashtextextended\(\?, 0\)/);
  assert.deepEqual(trace[anchor]!.values, [JSON.stringify(["checkout-session", merchantId, sessionId])]);
  assert.equal(trace[anchor]!.tx, true);
  const firstSessionIO = trace.findIndex(entry => entry.kind.startsWith("checkout.") || entry.sql?.includes("checkout_sessions"));
  assert.ok(firstSessionIO > anchor, "anchor must precede checkout row lock/read/write");
  assert.ok(trace.filter(entry => entry.kind.startsWith("checkout.")).every(entry => entry.tx), "session IO must use the same transaction");
  for (const [index, entry] of trace.entries()) {
    if (entry.sql?.includes("merchants") || entry.sql?.includes("merchant_rules")) assert.ok(index < anchor);
  }
}
const operations = {
  save: (repo: PrismaCheckoutRepository) => repo.saveSession(session()),
  cas: (repo: PrismaCheckoutRepository) => repo.saveSessionIfUnchanged(session(), session()),
  mutation: (repo: PrismaCheckoutRepository) => repo.commitCommercialMutation({ expected: session(), next: session() }),
  reopen: (repo: PrismaCheckoutRepository) => repo.reopenForBuyerEdit(merchantId, sessionId, "address"),
  benefits: (repo: PrismaCheckoutRepository) => repo.saveBenefitsIfMutable(session(), session(), merchantRules()),
  event: (repo: PrismaCheckoutRepository) => repo.recordEvent(merchantId, sessionId, "checkout_started"),
  turn: (repo: PrismaCheckoutRepository) => repo.appendChatTurn(merchantId, sessionId, { role: "buyer", text: "Olá", occurredAt: "2026-10-19T12:00:00Z" }),
  exchange: (repo: PrismaCheckoutRepository) => repo.appendChatExchange({ merchantId, sessionId,
    buyer: { role: "buyer", text: "Olá", occurredAt: "2026-10-19T12:00:00Z" },
    agent: { role: "agent", text: "Olá!", occurredAt: "2026-10-19T12:00:00Z" } }),
} satisfies Record<string, (repo: PrismaCheckoutRepository) => Promise<unknown>>;

for (const [name, operation] of Object.entries(operations)) {
  for (const nested of [false, true]) test(`${name}: session anchor precedes row IO (${nested ? "nested" : "direct"})`, async () => {
    const f = harness();
    if (nested) await f.repo.transaction(async repository => {
      assert.ok(repository instanceof PrismaCheckoutRepository); await operation(repository);
    });
    else await operation(f.repo);
    assertAnchor(f.trace); assert.equal(f.transactions(), 1);
  });
  test(`${name}: failed anchor prevents session and business writes`, async () => {
    const failure = new Error("synthetic_anchor_unavailable"), f = harness(row(), { anchorError: failure });
    await assert.rejects(operation(f.repo), error => error === failure);
    assert.equal(f.trace.some(entry => entry.kind !== "sql"), false);
  });
}

async function withStrategy(enabled: boolean, work: () => Promise<void>, incentive = false) {
  const keys = ["REVENUE_STRATEGY_EXECUTION_ENABLED", "REVENUE_STRATEGY_EXECUTION_MERCHANT_IDS",
    "REVENUE_INCENTIVE_EXECUTION_ENABLED", "REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS"] as const;
  const before = keys.map(key => process.env[key]);
  process.env.REVENUE_STRATEGY_EXECUTION_ENABLED = String(enabled);
  process.env.REVENUE_STRATEGY_EXECUTION_MERCHANT_IDS = merchantId;
  process.env.REVENUE_INCENTIVE_EXECUTION_ENABLED = String(incentive);
  process.env.REVENUE_INCENTIVE_EXECUTION_MERCHANT_IDS = incentive ? merchantId : "";
  try { await work(); } finally { keys.forEach((key, index) => {
    if (before[index] === undefined) delete process.env[key]; else process.env[key] = before[index];
  }); }
}
for (const strategy of [false, true]) for (const exists of [false, true]) {
  test(`createIfAbsent anchors ${strategy ? "strategy" : "default"} path, existing=${exists}`, async () => withStrategy(strategy, async () => {
    const f = harness(exists ? row() : null);
    const input = session(); input.conversationId = "new-conversation-not-the-winner";
    const result = await f.repo.createSessionIfAbsent(input);
    assertAnchor(f.trace); assert.equal(f.transactions(), 1);
    assert.equal(result.created, !exists);
    if (exists) assert.equal(result.session.conversationId, session().conversationId);
  }));
}

test("default upsert P2002 rereads winner only after the transaction has exited", async () => withStrategy(false, async () => {
  const failure = Object.assign(new Error("synthetic_unique_conflict"), { code: "P2002" });
  const f = harness(null, { upsertError: failure });
  await f.repo.createSessionIfAbsent(session());
  const upsert = f.trace.findIndex(entry => entry.kind === "checkout.upsert");
  assert.ok(upsert >= 0); assert.equal(f.trace[upsert]!.tx, true);
  assert.equal(f.trace.at(-1)?.kind, "checkout.read"); assert.equal(f.trace.at(-1)?.tx, false);
}));

test("unknown commit does not retry creation or acknowledge success", async () => withStrategy(false, async () => {
  const failure = new Error("synthetic_commit_ack_unknown"), f = harness(null, { commitError: failure });
  await assert.rejects(f.repo.createSessionIfAbsent(session()), error => error === failure);
  assert.equal(f.transactions(), 1);
  assert.equal(f.trace.filter(entry => entry.kind === "checkout.upsert").length, 1);
}));

test("save creates an absent session only after the anchor and row lock", async () => {
  const f = harness(null); await f.repo.saveSession(session());
  assertAnchor(f.trace); assert.equal(f.trace.filter(entry => entry.kind === "checkout.create").length, 1);
});

for (const strategy of [false, true]) {
  test(`createIfAbsent reuses its outer transaction (strategy=${strategy})`, async () => withStrategy(strategy, async () => {
    const f = harness(null);
    const result = await f.repo.transaction(async repository => {
      assert.ok(repository instanceof PrismaCheckoutRepository); return repository.createSessionIfAbsent(session());
    });
    assert.equal(result.created, true); assertAnchor(f.trace); assert.equal(f.transactions(), 1);
  }));
  test(`createIfAbsent does no session IO after a failed anchor (strategy=${strategy})`, async () => withStrategy(strategy, async () => {
    const failure = new Error("synthetic_anchor_unavailable"), f = harness(null, { anchorError: failure });
    await assert.rejects(f.repo.createSessionIfAbsent(session()), error => error === failure);
    assert.equal(f.trace.some(entry => entry.kind !== "sql"), false);
  }));
}

test("P2002 inside an owned outer transaction propagates without querying the aborted transaction", async () => withStrategy(false, async () => {
  const failure = Object.assign(new Error("synthetic_unique_conflict"), { code: "P2002" });
  const f = harness(null, { upsertError: failure });
  await assert.rejects(f.repo.transaction(async repository => {
    assert.ok(repository instanceof PrismaCheckoutRepository); return repository.createSessionIfAbsent(session());
  }), error => error === failure);
  assert.equal(f.trace.at(-1)?.kind, "checkout.upsert"); assert.equal(f.transactions(), 1);
}));

for (const strategy of [false, true]) test(`incentive pilot preserves merchant-before-anchor order (strategy=${strategy})`, async () => withStrategy(strategy, async () => {
  const created = harness(null);
  assert.equal((await created.repo.createSessionIfAbsent(session())).created, true);
  assertAnchor(created.trace);
  const saved = harness(); await saved.repo.saveSession(session()); assertAnchor(saved.trace);
}, true));

test("an existing default session is never reported as created or overwritten, even with the same conversation", async () => withStrategy(false, async () => {
  const f = harness(); const input = session(); input.cart.total = 123456;
  const result = await f.repo.createSessionIfAbsent(input);
  assert.equal(result.created, false); assert.equal(result.session.cart.total, session().cart.total);
  assert.equal(f.trace.some(entry => ["checkout.create", "checkout.upsert", "checkout.update"].includes(entry.kind)), false);
  assertAnchor(f.trace);
}));

// Deterministic source-level characterization, NOT PostgreSQL lock/HTTP proof
// and NOT an attribution of the earlier intermittent HTTP409. The delegate
// models the deployed trigger's version+1 for EVERY UPDATE, including telemetry.
function commercialRemountSession():CheckoutSession{
  return sessionWithCommercialValues();
}
function sessionWithCommercialValues():CheckoutSession{
  const initial=session();
  initial.cart={currency:"BRL",source:"storefront",cart_ref:"synthetic-source",total:19,currentDiscount:1,
    discountBudget:{version:1,originalSubtotalCents:2000,promotionDiscountCents:100},
    items:[{sku:"TARGET",variantId:"synthetic-variant",product_id:"synthetic-product",variant:JSON.stringify(["synthetic-variant",["large"]]),
      name:"Synthetic target",quantity:1,price:19,originalPrice:20,productType:"physical",fulfillmentStrategy:"physical",
      selected_options:[{group_name:"Size",item_name:"Large",price_modifier:5}],
      crossSellIntent:{version:1,promotionId:"synthetic-promotion",promotionUpdatedAt:"2026-10-20T12:00:00.000Z",
        acceptedQuantity:1,originalUnitPriceCents:2000,maximumUnitPriceCents:1900,selectedOptionItemIds:["large"]}}]};
  initial.customer={email:"synthetic@example.test",email_verified:true,fullName:"Synthetic Buyer"};
  return initial;
}
for(const refreshCart of [false,true])test(`telemetry between bootstrap read and ${refreshCart?"recovery refresh":"remount save"} gives one controlled CAS conflict, never a silent rebase`,async()=>withStrategy(false,async()=>{
  const initial=commercialRemountSession(),f=harness(row(initial));
  const originalGet=f.repo.getSession.bind(f.repo);
  let observed!:()=>void,release!:()=>void;
  const observedRead=new Promise<void>(resolve=>{observed=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  let first=true;
  f.repo.getSession=async(merchant,checkout)=>{
    const snapshot=await originalGet(merchant,checkout);
    if(first){first=false;observed();await gate;}
    return snapshot;
  };
  const bootstrap=new CheckoutBootstrapService(f.repo,f.repo);
  const input={merchant_id:merchantId,session_id:sessionId,cart:structuredClone(initial.cart)};
  const pending=bootstrap.bootstrap(input,initial.globalUserId,true,{refreshCart});
  // Attach rejection before releasing the barrier: no timer or unhandled race.
  const refusal=assert.rejects(pending,(error:{getStatus():number;message:string})=>{
    assert.equal(error.getStatus(),409);assert.equal(error.message,"CHECKOUT_SESSION_VERSION_CONFLICT");return true;
  });
  await observedRead;
  assert.equal(f.transactions(),0); // Bootstrap has read but has not acquired its write transaction.
  await f.repo.recordEvent(merchantId,sessionId,"idle_30_seconds",{source:"synthetic_concurrency_characterization"});
  const afterEvent=structuredClone(f.stored());assert.ok(afterEvent);
  assert.equal(afterEvent.version,2);assert.deepEqual(afterEvent.cart,initial.cart);
  assert.deepEqual(afterEvent.customer,initial.customer);assert.deepEqual(afterEvent.shipping,initial.shipping);
  assert.equal(f.trace.filter(entry=>entry.kind==="event.create").length,1);
  release();await refusal;
  assert.deepEqual(f.stored(),afterEvent);
  assert.equal(f.trace.filter(entry=>entry.kind==="checkout.update").length,1,"only telemetry may UPDATE");
  assert.equal(f.trace.filter(entry=>entry.kind==="event.create").length,1);
  assert.equal(f.trace.some(entry=>["outbox.append","coupon.cancel","checkout.create","checkout.upsert"].includes(entry.kind)),false);
  assert.equal(f.transactions(),2,"one telemetry tx and one failed bootstrap tx; no automatic retry");
  // A separate NEW caller-owned fresh remount succeeds. This is not an
  // automatic replay of the rejected recovery command and does not reprice.
  const fresh=await bootstrap.bootstrap(input,initial.globalUserId,true);
  assert.equal(fresh.session.persistenceVersion,3);assert.deepEqual(fresh.session.cart,initial.cart);
  assert.equal(f.trace.filter(entry=>entry.kind==="checkout.update").length,2);
  assert.equal(f.trace.filter(entry=>entry.kind==="outbox.append").length,1);
  assert.equal(f.trace.filter(entry=>entry.kind==="event.create").length,1);
  assert.equal(f.trace.some(entry=>["checkout.create","checkout.upsert"].includes(entry.kind)),false);
}));
