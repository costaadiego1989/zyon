import "reflect-metadata";
import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { ShippingWalletService } from "./shipping-wallet.service.js";
import { decryptCommerceSecret, encryptCommerceSecret } from "../../commerce/infrastructure/commerce-secret-cipher.js";
import { MelhorEnvioWalletAdapter, readMelhorEnvioWallet } from "../infrastructure/adapters/melhor-envio-wallet.adapter.js";
import { parseShippingWallet, walletLocation } from "../domain/shipping-wallet.js";

const originalFetch = globalThis.fetch;
const originalBase = process.env.MELHOR_ENVIO_BASE_URL;
const originalKey = process.env.AACP_COMMERCE_ENC_KEY;
beforeEach(() => {
  process.env.MELHOR_ENVIO_BASE_URL = "https://melhorenvio.com.br";
  process.env.AACP_COMMERCE_ENC_KEY = "shipping-wallet-unit-fixture-key";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of [["MELHOR_ENVIO_BASE_URL", originalBase], ["AACP_COMMERCE_ENC_KEY", originalKey]]) {
    if (value === undefined) delete process.env[key!]; else process.env[key!] = value;
  }
});

type Row = Record<string, any>;
function fixture() {
  const wallets = new Map<string, Row>();
  const merchants = new Map(["a", "b"].map(id => [id, { id, melhorEnvioEnabled: true,
    melhorEnvioAccessToken: encryptCommerceSecret(`token-${id}`), melhorEnvioRefreshToken: "encrypted-refresh",
    users: [{ email: `owner-${id}@example.test` }] }]));
  const notifications: Row[] = [], emails: Row[] = [], tokenReads: Row[] = [];
  const amounts: Record<string, number> = { a: 80.25, b: 123.45 };
  let status = 200, emailStatus = "sent", onFetch: (() => void) | undefined;
  let fetches = 0;
  function matches(row: Row, where: Row): boolean {
    return Object.entries(where).every(([key, expected]: [string, any]) => {
      if (key === "AND") return expected.every((item: Row) => matches(row, item));
      if (key === "OR") return expected.some((item: Row) => matches(row, item));
      if (key === "merchantId_environment") return matches(row, expected);
      const actual = key === "merchant" ? merchants.get(row.merchantId) : row[key];
      if (expected && typeof expected === "object" && !(expected instanceof Date)) {
        if ("increment" in expected) throw new Error("increment is not a query");
        if ("lt" in expected) return actual !== null && actual < expected.lt;
        if ("lte" in expected) return actual !== null && actual <= expected.lte;
        if ("not" in expected) return actual !== expected.not;
        return matches(actual, expected);
      }
      return actual === expected;
    });
  }
  const apply = (row: Row, data: Row) => {
    for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === "object" && "increment" in value
      ? row[key] + value.increment : value;
    return { ...row };
  };
  const table = {
    findUnique: async ({ where }: Row) => { const row = [...wallets.values()].find(row => matches(row, where)); return row ? { ...row } : null; },
    findUniqueOrThrow: async ({ where }: Row) => {
      const row = [...wallets.values()].find(row => matches(row, where)); assert.ok(row); return { ...row };
    },
    findMany: async ({ where }: Row) => [...wallets.values()].filter(row => matches(row, where)).map(row => ({ ...row })),
    upsert: async ({ where, create, update }: Row) => {
      const existing = [...wallets.values()].find(row => matches(row, where));
      if (existing) return apply(existing, update);
      const row = { id: `wallet-${wallets.size}`, alertEnabled: false, thresholdCents: 10000, emailEnabled: false,
        balanceCents: null, reservedCents: null, debtsCents: null, checkedAt: null, lastAttemptAt: null, lastErrorCode: null,
        lowBalance: false, alertId: null, emailPending: false, emailAttempts: 0, emailStartedAt: null, emailSentAt: null, emailRecipient: null, leaseToken: null, leaseUntil: null,
        ...create };
      wallets.set(row.id, row); return { ...row };
    },
    update: async ({ where, data }: Row) => { const row = [...wallets.values()].find(row => matches(row, where)); assert.ok(row); return apply(row, data); },
    updateMany: async ({ where, data }: Row) => {
      let count = 0; for (const row of wallets.values()) if (matches(row, where)) { apply(row, data); count++; }
      return { count };
    },
  };
  const db: Row = { melhorEnvioWallet: table,
    merchant: {
      findUnique: async ({ where }: Row) => merchants.get(where.id) ?? null,
      findFirst: async ({ where }: Row) => [...merchants.values()].find(row => matches(row, where)) ?? null,
    },
    merchantNotification: { findFirst: async ({ where }: Row) => notifications.find(row => matches(row, where)) ?? null, create: async ({ data }: Row) => {
      assert.ok(!notifications.some(row => row.id === data.id)); notifications.push(data); return data;
    } },
  };
  let transactionTail = Promise.resolve<unknown>(undefined);
  db.$transaction = (fn: (tx: Row) => Promise<unknown>) => {
    const next = transactionTail.then(() => fn(db)); transactionTail = next.catch(() => undefined); return next;
  };
  const service = new ShippingWalletService(db as never, { resolveToken: async (id: string, options: Row) => {
    tokenReads.push({ id, ...options }); return `token-${id}`;
  } }, { send: async (input: Row) => { emails.push(input); return { status: emailStatus, messageId: emailStatus === "sent" ? "msg-1" : "" }; } } as never,
  new MelhorEnvioWalletAdapter((encrypted, token) => decryptCommerceSecret(encrypted) === token));
  globalThis.fetch = async (_url, init) => {
    fetches++; onFetch?.();
    const id = new Headers(init?.headers).get("Authorization")!.slice(-1);
    return new Response(JSON.stringify({ balance: amounts[id], reserved: 20, debts: 10 }), { status });
  };
  return { service, wallets, merchants, amounts, notifications, emails, tokenReads,
    fetches: () => fetches, setStatus: (next: number) => { status = next; }, setEmailStatus: (next: string) => { emailStatus = next; },
    onFetch: (action: () => void) => { onFetch = action; },
    expire: () => { for (const row of wallets.values()) { row.lastAttemptAt = null; row.checkedAt = new Date(0); } },
  };
}

test("wallet uses the provider balance without subtracting reserved funds or debts", () => {
  assert.deepEqual(parseShippingWallet({ balance: "1624.90", reserved: 42.31, debts: 87 }), { balanceCents: 162490, reservedCents: 4231, debtsCents: 8700 });
  assert.equal(parseShippingWallet({ balance: 0 }).balanceCents, 0);
  assert.equal(parseShippingWallet({ balance: -1.25 }).balanceCents, -125);
  for (const value of [null, {}, { balance: "" }, { balance: "1,25" }, { balance: true }, { balance: 1.001 }, { balance: Infinity },
    { balance: 9e99 }, { balance: 1, reserved: -1 }, { balance: 1, debts: "unknown" }]) assert.throws(() => parseShippingWallet(value));
});

test("wallet adapter only reads the official endpoint with bearer, user agent and timeout", async () => {
  let observed = false;
  const result = await readMelhorEnvioWallet("https://melhorenvio.com.br", "fixture-token", async (url, init) => {
    assert.equal(url, "https://melhorenvio.com.br/api/v2/me/balance");
    assert.equal(init?.method, "GET"); assert.equal(init?.redirect, "error"); assert.ok(init?.signal);
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("Authorization"), "Bearer fixture-token"); assert.match(headers.get("User-Agent")!, /Zyon/);
    observed = true; return new Response('{"balance":12.34}');
  });
  assert.equal(observed, true); assert.equal(result.balanceCents, 1234);
  await assert.rejects(readMelhorEnvioWallet("https://untrusted.example", "fixture-token"), /provider_unavailable/);
  assert.equal(walletLocation("https://sandbox.melhorenvio.com.br").environment, "test");
});

test("wallet maps authentication, permission and availability failures without exposing provider bodies", async () => {
  for (const [status, code] of [[401, "reconnect_required"], [403, "permission_denied"], [429, "provider_unavailable"], [500, "provider_unavailable"]] as const) {
    await assert.rejects(readMelhorEnvioWallet("https://melhorenvio.com.br", "fixture-token", async () => new Response("private provider body", { status })), { message: code });
  }
});

test("tenant balance uses only its own token and disconnected merchants make no carrier request", async () => {
  const h = fixture();
  assert.equal((await h.service.get("a")).balanceCents, 8025);
  assert.equal((await h.service.get("b")).balanceCents, 12345);
  assert.deepEqual(h.tokenReads, [{ id: "a", allowPlatformFallback: false }, { id: "b", allowPlatformFallback: false }]);
  h.merchants.get("b")!.melhorEnvioAccessToken = null as never;
  const disconnected = await h.service.get("b", true);
  assert.equal(disconnected.status, "disconnected"); assert.equal(disconnected.balanceCents, null);
  assert.equal(h.fetches(), 2);
  await assert.rejects(h.service.get("missing"), /merchant_not_found/);
});

test("an unsuccessful refresh never turns the last known balance into zero or generates an alert", async () => {
  const h = fixture(); await h.service.get("a"); h.expire(); h.setStatus(503);
  const result = await h.service.get("a", true);
  assert.equal(result.status, "unavailable"); assert.equal(result.balanceCents, null);
  assert.equal(result.errorCode, "provider_unavailable"); assert.equal(h.notifications.length, 0);
  assert.equal([...h.wallets.values()][0].balanceCents, 8025);
});

test("low balance alerts persist once per episode, rearm after recovery and respect the strict threshold", async () => {
  const h = fixture();
  await h.service.configure("a", { enabled: true, thresholdCents: 10000, emailEnabled: false });
  assert.equal(h.notifications.length, 1); assert.equal(h.notifications[0].merchantId, "a");
  assert.equal(h.notifications[0].type, "shipping_wallet_low_balance"); assert.equal(h.notifications[0].metadata.balanceCents, 8025);
  assert.equal(h.notifications[0].metadata.href, "#delivery");
  assert.equal(h.notifications[0].body.includes("80,25"), true);
  h.expire(); await h.service.get("a", true); assert.equal(h.notifications.length, 1);
  await h.service.configure("a", { enabled: true, thresholdCents: 10000, emailEnabled: false });
  assert.equal(h.notifications.length, 1);
  h.amounts.a = 100; h.expire(); assert.equal((await h.service.get("a", true)).lowBalance, false);
  h.amounts.a = 99.99; h.expire(); await h.service.get("a", true);
  assert.equal(h.notifications.length, 2); assert.notEqual(h.notifications[0].id, h.notifications[1].id);
});

test("simultaneous balance refreshes cannot create duplicate low balance notifications", async () => {
  const h = fixture(); await h.service.configure("a", { enabled: true, thresholdCents: 10000, emailEnabled: false });
  h.expire(); const before = h.fetches();
  await Promise.all([h.service.get("a", true), h.service.get("a", true), h.service.get("a", true)]);
  assert.equal(h.fetches(), before + 1); assert.equal(h.notifications.length, 1);
});

test("account reconnection or changed settings invalidates a balance response already in flight", async () => {
  const h = fixture(); await h.service.get("a"); h.expire();
  h.onFetch(() => {
    h.merchants.get("a")!.melhorEnvioAccessToken = encryptCommerceSecret("different-account");
    for (const row of h.wallets.values()) { row.checkedAt = null; row.balanceCents = null; row.leaseToken = null; row.leaseUntil = null; }
  });
  const result = await h.service.get("a", true);
  assert.equal(result.balanceCents, null); assert.equal(h.notifications.length, 0);
});

test("identical concurrent settings saves keep one low-balance episode", async () => {
  const h = fixture();
  const settings = { enabled: true, thresholdCents: 10000, emailEnabled: false };
  await Promise.all([h.service.configure("a", settings), h.service.configure("a", settings)]);
  assert.equal(h.notifications.length, 1);
  const episode = [...h.wallets.values()][0].alertId;
  h.expire(); await Promise.all([h.service.configure("a", settings), h.service.configure("a", settings)]);
  assert.equal(h.notifications.length, 1); assert.equal([...h.wallets.values()][0].alertId, episode);
});

test("monitor detects low balances with no open dashboard and retries email with a stable idempotency key", async () => {
  const h = fixture(); h.setEmailStatus("skipped");
  await h.service.configure("a", { enabled: true, thresholdCents: 10000, emailEnabled: true });
  assert.equal(h.emails.length, 1); assert.equal([...h.wallets.values()][0].emailPending, true);
  assert.equal(h.emails[0].to, "owner-a@example.test"); assert.equal(h.emails[0].requireDelivery, true);
  assert.match(h.emails[0].html, /https:\/\/app.melhorenvio.com.br\/melhor-carteira/);
  h.amounts.a = 71.12; h.setEmailStatus("sent"); h.expire(); await h.service.monitor();
  assert.equal(h.emails.length, 2); assert.equal(h.emails[0].idempotencyKey, h.emails[1].idempotencyKey);
  assert.equal(h.emails[0].html, h.emails[1].html); assert.equal(h.emails[0].text, h.emails[1].text);
  assert.equal([...h.wallets.values()][0].emailPending, false); assert.equal(h.notifications.length, 1);
  h.amounts.a = 150; h.expire(); await h.service.monitor();
  h.amounts.a = 50; h.expire(); await h.service.monitor();
  assert.equal(h.notifications.length, 2); assert.equal(h.emails.length, 3);
  assert.notEqual(h.emails[1].idempotencyKey, h.emails[2].idempotencyKey);
});

test("wallet settings reject invalid limits and persisted sandbox balances never appear as live balances", async () => {
  const h = fixture();
  for (const thresholdCents of [0, -1, 1.5, 5000001, "10000", NaN]) {
    await assert.rejects(h.service.configure("a", { enabled: true, thresholdCents, emailEnabled: false } as never), /wallet_alert_settings_invalid/);
  }
  process.env.MELHOR_ENVIO_BASE_URL = "https://sandbox.melhorenvio.com.br";
  const sandbox = await h.service.configure("a", { enabled: true, thresholdCents: 10000, emailEnabled: false });
  assert.equal(sandbox.environment, "test"); assert.match(sandbox.rechargeUrl, /sandbox/);
  process.env.MELHOR_ENVIO_BASE_URL = "https://melhorenvio.com.br";
  const live = await h.service.get("a");
  assert.equal(live.environment, "live"); assert.equal(live.alert.enabled, false); assert.equal(h.wallets.size, 2);
});

test("email can resume an unaccepted delivery after being re-enabled without resending an accepted notice", async () => {
  const h = fixture(); h.setEmailStatus("skipped");
  const settings = { enabled: true, thresholdCents: 10000, emailEnabled: true };
  await h.service.configure("a", settings);
  const original = h.emails[0].idempotencyKey;
  await h.service.configure("a", { ...settings, emailEnabled: false });
  h.setEmailStatus("sent"); await h.service.configure("a", settings);
  assert.equal(h.emails.length, 2); assert.equal(h.emails[1].idempotencyKey, original);
  assert.ok([...h.wallets.values()][0].emailSentAt);
  await h.service.configure("a", { ...settings, emailEnabled: false });
  await h.service.configure("a", settings);
  assert.equal(h.emails.length, 2); assert.equal(h.notifications.length, 1);
});

test("uncertain email delivery is not retried after its idempotency safety window", async () => {
  const h = fixture(); h.setEmailStatus("skipped");
  await h.service.configure("a", { enabled: true, thresholdCents: 10000, emailEnabled: true });
  [...h.wallets.values()][0].emailStartedAt = new Date(Date.now() - 24 * 3600_000);
  h.expire(); await h.service.monitor();
  assert.equal(h.emails.length, 1); assert.equal((await h.service.get("a")).emailDeliveryFailed, true);
});

test("retry keeps its original recipient snapshot when the active owner changes", async () => {
  const h = fixture(); h.setEmailStatus("skipped");
  const settings = { enabled: true, thresholdCents: 10000, emailEnabled: true };
  await h.service.configure("a", settings);
  await h.service.configure("a", { ...settings, emailEnabled: false });
  h.merchants.get("a")!.users[0].email = "new-owner@example.test";
  await h.service.configure("a", settings); h.expire(); await h.service.monitor();
  assert.equal(h.emails.length, 1);
  assert.equal([...h.wallets.values()][0].emailRecipient, "owner-a@example.test");
  assert.equal([...h.wallets.values()][0].emailPending, true);
});
