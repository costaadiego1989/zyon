import assert from "node:assert/strict";
import test from "node:test";
import { ConnectOmieUseCase } from "../use-cases/connect-omie.use-case.js";
import { ErpSyncService } from "./erp-sync.service.js";
import { decryptErpSecret, encryptErpSecret } from "../../infrastructure/adapters/erp-secret-cipher.js";
import { ErpProviderError, readOmieResponse } from "../../infrastructure/adapters/erp-provider-error.js";
import { blingClientFingerprint } from "../../infrastructure/adapters/bling-token-identity.js";

test("two companies connect their own Omie applications and can rotate only their own secret", async t => {
  const original = globalThis.fetch, rows = new Map<string, any>(), requests: any[] = [];
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (_url, init) => { requests.push(JSON.parse(String(init?.body))); return Response.json({ total_de_registros: 0 }); };
  const repo = {
    findByProvider: async (merchantId: string, provider: string) => rows.get(`${merchantId}:${provider}`) ?? null,
    upsert: async (merchantId: string, provider: string, data: any) => { const row = { id: `${merchantId}:${provider}`, merchantId, provider, ...data }; rows.set(row.id, row); return row; },
  };
  const useCase = new ConnectOmieUseCase(repo as never);
  await useCase.execute({ merchantId: "company-a", appKey: " key-a ", appSecret: " secret-a " });
  await useCase.execute({ merchantId: "company-b", appKey: "key-b", appSecret: "secret-b" });
  await useCase.execute({ merchantId: "company-a", appKey: "key-a", appSecret: "rotated-a" });
  assert.deepEqual(requests.map(r => [r.app_key, r.app_secret]), [["key-a", "secret-a"], ["key-b", "secret-b"], ["key-a", "rotated-a"]]);
  assert.equal(decryptErpSecret(rows.get("company-a:omie").refreshTokenCipher), "rotated-a");
  assert.equal(decryptErpSecret(rows.get("company-b:omie").refreshTokenCipher), "secret-b");
  assert.notEqual(rows.get("company-a:omie").accessTokenCipher, "key-a");
  await assert.rejects(() => useCase.execute({ merchantId: "company-a", appKey: "key-b", appSecret: "secret-b" }), /omie_application_change_requires_disconnect/);
  assert.equal(decryptErpSecret(rows.get("company-a:omie").accessTokenCipher), "key-a");
});

test("invalid Omie credentials cannot replace an existing valid connection or expose the provider body", async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => Response.json({ faultstring: "A chave de acesso está inválida ou o aplicativo está suspenso SECRET-EXAMPLE" }, { status: 403 });
  const useCase = new ConnectOmieUseCase({ upsert: async () => assert.fail("must not replace saved credentials") } as never);
  await assert.rejects(() => useCase.execute({ merchantId: "company-a", appKey: "new-key", appSecret: "bad-secret" }), error => {
    assert.equal((error as Error).message, "erp_omie_credentials_invalid_or_app_suspended");
    assert.equal(JSON.stringify(error).includes("SECRET-EXAMPLE"), false);
    return true;
  });
});

for (const [status, response, expected, reconnect, minimumDelay] of [
  [425, {}, "erp_omie_temporarily_blocked", false, 30 * 60_000],
  [429, {}, "erp_omie_rate_limited", false, 60_000],
  [403, { faultstring: "Limite diário de requisições atingido" }, "erp_omie_daily_limit", false, 24 * 60 * 60_000],
  [403, { faultstring: "A chave de acesso está inválida ou o aplicativo está suspenso" }, "erp_omie_credentials_invalid_or_app_suspended", true, 0],
  [503, {}, "erp_omie_http_503", false, 0],
] as const) {
  test(`Omie distinguishes ${expected} from an invalid company credential`, async () => {
    await assert.rejects(() => readOmieResponse(Response.json(response, { status })), error => {
      assert.ok(error instanceof ErpProviderError);
      assert.equal(error.message, expected); assert.equal(error.requiresReconnect, reconnect);
      assert.ok((error.retryAfterMs ?? 0) >= minimumDelay);
      return true;
    });
  });
}

function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (key === "OR") return value.some((part: any) => matches(row, part));
    if (key === "AND") return value.every((part: any) => matches(row, part));
    if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      if (value.in) return value.in.includes(row[key]);
      if (value.not !== undefined) return row[key] !== value.not;
    }
    return row[key] === value;
  });
}

function queueFixture() {
  const connections = ["a", "b"].map(letter => ({ id: `connection-${letter}`, merchantId: `company-${letter}`, provider: "omie", status: "connected", directionMode: "bidirectional", accessTokenCipher: encryptErpSecret(`key-${letter}`), refreshTokenCipher: encryptErpSecret(`secret-${letter}`), config: {}, lastErrorCode: null } as any));
  const jobs = [
    { id: "full-a", connectionId: "connection-a", merchantId: "company-a", kind: "full", status: "queued", attempts: 0 },
    { id: "sale-a", connectionId: "connection-a", merchantId: "company-a", kind: "sale", status: "queued", attempts: 0 },
    { id: "full-b", connectionId: "connection-b", merchantId: "company-b", kind: "full", status: "queued", attempts: 0 },
  ] as any[];
  const table = (rows: any[]) => ({
    findFirst: async ({ where }: any) => rows.find(row => matches(row, where)) ?? null,
    findUnique: async ({ where }: any) => rows.find(row => matches(row, where)) ?? null,
    updateMany: async ({ where, data }: any) => { const found = rows.filter(row => matches(row, where)); found.forEach(row => Object.assign(row, data)); return { count: found.length }; },
    update: async ({ where, data }: any) => { const found = rows.find(row => matches(row, where)); assert.ok(found); Object.assign(found, data); return found; },
    create: async ({ data }: any) => { const row = { id: `new-${rows.length}`, ...data }; rows.push(row); return row; },
  });
  const prisma: any = { $queryRaw: async () => [], erpConnection: table(connections), erpSyncJob: table(jobs) };
  prisma.$transaction = async (work: any) => typeof work === "function" ? work(prisma) : Promise.all(work);
  const service = new ErpSyncService(prisma) as any;
  service.assertSnapshotCurrent = async () => {};
  service.kick = () => {};
  return { service, prisma, connections, jobs };
}

test("permanent authorization failure blocks one company's queue and preserves another company's work", async () => {
  const f = queueFixture();
  f.service.pullSnapshots = async () => { throw new ErpProviderError("erp_omie_credentials_invalid_or_app_suspended", true); };
  await f.service.process("full-a");
  assert.equal(f.connections[0].status, "error");
  assert.equal(f.jobs[0].status, "blocked"); assert.equal(f.jobs[1].status, "blocked");
  assert.equal(f.jobs[0].nextAttemptAt, null);
  assert.equal(f.connections[1].status, "connected"); assert.equal(f.jobs[2].status, "queued");
  assert.equal(decryptErpSecret(f.connections[0].accessTokenCipher), "key-a");
});

test("a provider failure arriving after key rotation cannot disable the newly connected account", async () => {
  const f = queueFixture();
  const previous = { ...f.connections[0] }, job = { ...f.jobs[0], status: "running" };
  f.jobs[0].status = "running";
  f.connections[0].refreshTokenCipher = encryptErpSecret("fresh-secret");
  await f.service.pauseForReauthorization(previous, job, "erp_omie_credentials_invalid_or_app_suspended", false);
  assert.equal(f.connections[0].status, "connected"); assert.equal(f.jobs[0].status, "queued");
  assert.equal(decryptErpSecret(f.connections[0].refreshTokenCipher), "fresh-secret");
});

test("Omie 425 pauses queued work for thirty minutes and does not replace another worker's running job", async () => {
  const f = queueFixture();
  f.jobs.push({ id: "busy-a", connectionId: "connection-a", merchantId: "company-a", status: "running", kind: "sale" });
  f.service.pullSnapshots = async () => { throw new ErpProviderError("erp_omie_temporarily_blocked", false, 30 * 60_000); };
  const before = Date.now(); await f.service.process("full-a");
  assert.equal(f.connections[0].status, "connected");
  assert.ok(Date.parse(f.connections[0].config.erpRetryAfterAt) >= before + 30 * 60_000);
  assert.equal(f.jobs[0].attempts, 0); assert.equal(f.jobs[3].status, "running");
  assert.equal(f.connections[1].lastErrorCode, null);
  await assert.rejects(() => f.service.enqueueFull("company-a", "connection-a"), /erp_provider_cooldown/);
});

test("a delayed Omie cooldown cannot pause a newly authenticated company", async () => {
  const f = queueFixture(), previous = { ...f.connections[0] };
  f.jobs[0].status = "running";
  f.connections[0].refreshTokenCipher = encryptErpSecret("fresh-secret");
  await f.service.pauseForCooldown(previous, f.jobs[0], "erp_omie_temporarily_blocked", 30 * 60_000);
  assert.equal(f.connections[0].lastErrorCode, null);
  assert.equal(f.connections[0].config.erpRetryAfterAt, undefined);
  assert.equal(f.jobs[0].status, "queued");
  assert.equal(f.jobs[1].nextAttemptAt, undefined);
});

test("reconnecting resumes blocked sales with their original identity and schedules a fresh snapshot", async () => {
  const f = queueFixture();
  for (const row of f.jobs.slice(0, 2)) Object.assign(row, { status: "blocked", lastErrorCode: "erp_omie_credentials_invalid_or_app_suspended" });
  await f.service.enqueueFull("company-a", "connection-a");
  assert.equal(f.jobs[0].status, "superseded");
  assert.equal(f.jobs[1].id, "sale-a"); assert.equal(f.jobs[1].status, "queued");
  assert.equal(f.jobs[2].status, "queued"); assert.equal(f.jobs[3].kind, "full");
  await assert.rejects(() => f.service.enqueueFull("company-b", "connection-a"), /erp_connection_not_found/);
});

test("a dispatched stock write stays uncertain even when reauthorization is required", async () => {
  const f = queueFixture(); f.jobs[0].status = "running";
  await f.service.pauseForReauthorization(f.connections[0], { ...f.jobs[0], kind: "catalog_stock" }, "erp_omie_access_denied", true);
  assert.equal(f.jobs[0].status, "uncertain");
  assert.equal(f.jobs[0].lastErrorCode, "erp_catalog_delivery_uncertain");
});

test("simultaneous Bling refreshes use one renewal and persist both rotated encrypted tokens", async t => {
  const env = { BLING_CLIENT_ID: process.env.BLING_CLIENT_ID, BLING_CLIENT_SECRET: process.env.BLING_CLIENT_SECRET };
  const original = globalThis.fetch;
  process.env.BLING_CLIENT_ID = "a".repeat(40); process.env.BLING_CLIENT_SECRET = "application-secret";
  t.after(() => { globalThis.fetch = original; for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const saved: any = { id: "bling-a", merchantId: "company-a", provider: "bling", status: "connected", accessTokenCipher: encryptErpSecret("expired-token"), refreshTokenCipher: encryptErpSecret("refresh-once"), tokenExpiresAt: new Date(0), config: { blingClientFingerprint: blingClientFingerprint() } };
  let refreshes = 0, gate = Promise.resolve();
  globalThis.fetch = async (_url, init) => {
    refreshes++; assert.equal(new URLSearchParams(String(init?.body)).get("refresh_token"), "refresh-once");
    return Response.json({ access_token: "fresh-token", refresh_token: "rotated-refresh", expires_in: 21600 });
  };
  const tx = { $queryRaw: async (_strings: unknown, id: string, merchantId: string) => { assert.equal(id, saved.id); assert.equal(merchantId, saved.merchantId); }, erpConnection: { findFirst: async ({ where }: any) => { assert.equal(where.merchantId, "company-a"); return { ...saved }; }, update: async ({ data }: any) => Object.assign(saved, data) } };
  const prisma = { $transaction: async (work: any) => { const previous = gate; let release!: () => void; gate = new Promise(resolve => { release = resolve; }); await previous; try { return await work(tx); } finally { release(); } } };
  const service = new ErpSyncService(prisma as never) as any;
  assert.deepEqual(await Promise.all([service.blingToken({ ...saved }), service.blingToken({ ...saved })]), ["fresh-token", "fresh-token"]);
  assert.equal(refreshes, 1); assert.equal(decryptErpSecret(saved.refreshTokenCipher), "rotated-refresh");
  assert.ok(saved.tokenExpiresAt.getTime() > Date.now());
  const oldClientToken = `header.${Buffer.from(JSON.stringify({ aud: "b".repeat(40) })).toString("base64url")}.signature`;
  await assert.rejects(() => service.blingToken({ ...saved, config: {}, accessTokenCipher: encryptErpSecret(oldClientToken) }), /erp_bling_app_changed/);
  assert.equal(refreshes, 1);
});
