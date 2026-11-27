import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { seedFiscalSale } from "../../../../tests/fiscal-schema-seed.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { AuthGuard } from "../../auth/presentation/auth.guard.js";
import { TenantRoleGuard } from "../../auth/presentation/tenant-role.guard.js";
import { JwtService } from "../../auth/domain/services/jwt.service.js";
import { AuthCookieService } from "../../auth/domain/services/auth-cookie.service.js";
import { PrismaAuthRepository } from "../../auth/infrastructure/prisma-auth.repository.js";
import { FiscalCredentialCipher } from "../infrastructure/fiscal-credential-cipher.js";
import { FiscalOlistNotifications } from "../infrastructure/fiscal-olist-notifications.js";
import { FISCAL_OLIST_NOTIFICATIONS } from "../domain/fiscal-olist-notifications.port.js";
import { FiscalOlistNotificationsController, FiscalOlistNotificationCallbackController } from "./fiscal-olist-notifications.controller.js";
import { FiscalWebhookDispatcher } from "../infrastructure/fiscal-webhook.dispatcher.js";
import { FiscalErpCredentials } from "../infrastructure/fiscal-erp-credentials.js";

let f: Awaited<ReturnType<typeof createFiscalFixture>>, jwt: JwtService, notifications: FiscalOlistNotifications;
const cipher = new FiscalCredentialCipher({ AACP_PII_ENC_KEY: "local-only-olist-notification-key" });
const credential = { contract: "olist_oauth_v3", issuerTaxId: "12ABC34501DE35", environment: "homologation", token: "private-rotating-access", refreshToken: "private-rotating-refresh", clientId: "private-app", clientSecret: "private-app-secret" };
before(async () => {
  f = await createFiscalFixture({ rawBody: true, controllers: [FiscalOlistNotificationsController, FiscalOlistNotificationCallbackController], providers: [AuthGuard, TenantRoleGuard,
    { provide: JwtService, useFactory: (p: PrismaClient) => (jwt = new JwtService("olist-notification-http-secret", 3600, new PrismaAuthRepository(p))), inject: [PRISMA_CLIENT] },
    { provide: AuthCookieService, useFactory: () => new AuthCookieService() },
    { provide: FISCAL_OLIST_NOTIFICATIONS, useFactory: (p: PrismaClient) => (notifications = new FiscalOlistNotifications(p, cipher, { API_PUBLIC_URL: "https://api.example.test" })), inject: [PRISMA_CLIENT] },
  ] });
}, { timeout: 120000 });
after(async () => { await f?.close(); });

async function actor(merchantId: string, role: "owner" | "admin" | "staff" = "owner") {
  const user = await f.prisma.merchantUser.create({ data: { merchantId, email: randomUUID() + "@example.test", role } });
  await f.prisma.merchantTeamMember.create({ data: { merchantId, userId: user.id, role: role.toUpperCase() } });
  return jwt.issue({ merchantId, userId: user.id, email: user.email, role });
}
async function arrange() {
  const sale = await seedFiscalSale(f, { provider: "tiny" });
  await f.prisma.fiscalIntent.update({ where: { id: sale.intent.id }, data: { state: "processing" } });
  await f.prisma.fiscalConnection.update({ where: { id: sale.connection.id }, data: { credentialCipher: cipher.encrypt(JSON.stringify(credential)) } });
  const token = await actor(sale.merchantId);
  const request = (method: string, id = sale.connection.id, body?: unknown, auth = token) => fetch(f.first.url + "/v1/merchants/me/fiscal/olist/connection/" + id + "/notifications" + (method === "GET" ? "?environment=homologation" : ""), {
    method, headers: { ...(auth ? { authorization: "Bearer " + auth } : {}), "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const configured = await request("POST", sale.connection.id, { environment: "homologation" });
  assert.equal(configured.status, 201);
  const value = await configured.json() as { notificationUrl: string };
  const url = new URL(value.notificationUrl);
  const notify = (body: unknown = {}, target = url) => fetch(f.first.url + target.pathname + target.search, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { ...sale, token, request, url, notify };
}
const events = (merchantId: string, eventType = "fiscal.olist.notification.received") => f.prisma.outboxMessage.findMany({ where: { merchantId, eventType } });

test("TINY-05 scoped notification configuration encrypts the secret and supports explicit rotation", async () => {
  const a = await arrange(); assert.equal(a.url.origin, "https://api.example.test");
  assert.equal(a.url.pathname, "/v1/webhooks/fiscal/olist/" + a.connection.id + "/notification");
  assert.match(a.url.searchParams.get("key")!, /^[A-Za-z0-9_-]{43}$/);
  const connection = await f.prisma.fiscalConnection.findUniqueOrThrow({ where: { id: a.connection.id } });
  assert.equal(connection.credentialCipher!.includes(a.url.searchParams.get("key")!), false);
  const saved = JSON.parse(cipher.decrypt(connection.credentialCipher!));
  assert.equal(saved.token, credential.token); assert.equal(saved.refreshToken, credential.refreshToken);
  assert.equal(saved.notificationToken, a.url.searchParams.get("key"));
  assert.equal((await (await a.request("GET")).json() as { notificationUrl: string }).notificationUrl, a.url.toString());
  assert.equal((await a.request("POST", a.connection.id, { environment: "homologation", rotate: false })).status, 201);
  assert.equal((await a.notify()).status, 200);
  const rotated = await a.request("POST", a.connection.id, { environment: "homologation", rotate: true });
  const next = new URL((await rotated.json() as { notificationUrl: string }).notificationUrl);
  assert.notEqual(next.searchParams.get("key"), a.url.searchParams.get("key"));
  assert.equal((await a.notify()).status, 401); assert.equal((await a.notify({}, next)).status, 200);
});

test("TINY-06 callback commits one deduplicated hint and ignores every received business field", async () => {
  const a = await arrange(), foreign = await arrange();
  const body = { merchantId: foreign.merchantId, environment: "production", connectionId: foreign.connection.id, state: "authorized", notas: [{ id: "foreign-invoice", chave_acesso: "forged-key", numero_protocolo: "forged-protocol", xml_url: "https://untrusted.invalid/private" }] };
  for (const response of await Promise.all([a.notify(body), a.notify({ completely: "different unspecified v3 envelope" }), a.notify(body)])) assert.equal(response.status, 200);
  const rows = await events(a.merchantId); assert.equal(rows.length, 1); assert.equal((await events(foreign.merchantId)).length, 0);
  const payload = rows[0]!.payload as Record<string, unknown>;
  assert.equal(payload.connectionId, a.connection.id); assert.equal(payload.environment, "homologation");
  assert.equal(JSON.stringify(rows).includes("forged"), false); assert.equal(JSON.stringify(rows).includes("untrusted.invalid"), false);
  assert.equal((await f.prisma.fiscalIntent.findUniqueOrThrow({ where: { id: a.intent.id } })).state, "processing");
  assert.equal(await f.prisma.fiscalDocument.count({ where: { merchantId: a.merchantId, state: "authorized" } }), 0);
});

test("TINY-07 durable notification pages every pending intent within its connection exactly once", async () => {
  const a = await arrange(), other = await arrange(); const ids = [a.intent.id];
  for (let i = 0; i < 52; i++) {
    const sale = await seedFiscalSale(f, { provider: "tiny", merchantId: a.merchantId, connectionId: a.connection.id }); ids.push(sale.intent.id);
    await f.prisma.fiscalIntent.update({ where: { id: sale.intent.id }, data: { state: i % 2 ? "processing" : "reconciliation_required" } });
  }
  const terminal = await seedFiscalSale(f, { provider: "tiny", merchantId: a.merchantId, connectionId: a.connection.id });
  await f.prisma.fiscalIntent.update({ where: { id: terminal.intent.id }, data: { state: "suppressed" } });
  const separate = await seedFiscalSale(f, { provider: "tiny", merchantId: a.merchantId });
  await f.prisma.fiscalIntent.update({ where: { id: separate.intent.id }, data: { state: "processing" } });
  const production = await seedFiscalSale(f, { provider: "tiny", merchantId: a.merchantId, environment: "production" });
  await f.prisma.fiscalIntent.update({ where: { id: production.intent.id }, data: { state: "processing" } });
  assert.equal((await a.notify()).status, 200);
  const first = (await events(a.merchantId))[0]!;
  await notifications.consume(a.merchantId, first.payload); await notifications.consume(a.merchantId, first.payload);
  assert.equal((await events(a.merchantId, "fiscal.reconciliation.requested")).length, 50);
  const pages = await events(a.merchantId); assert.equal(pages.length, 2);
  const second = pages.find(row => row.eventId !== first.eventId)!;
  await notifications.consume(a.merchantId, second.payload); await notifications.consume(a.merchantId, second.payload);
  const work = await events(a.merchantId, "fiscal.reconciliation.requested");
  assert.deepEqual(work.map(row => (row.payload as { intentId: string }).intentId).sort(), ids.sort());
  assert.equal(work.some(row => (row.payload as { intentId: string }).intentId === terminal.intent.id), false);
  assert.equal((await events(other.merchantId, "fiscal.reconciliation.requested")).length, 0);
  const seen: string[] = [];
  const dispatcher = new FiscalWebhookDispatcher(f.prisma, { read: async () => null }, { reconcile: async (scope, id) => { assert.equal(scope.merchantId, a.merchantId); assert.equal(scope.environment, "homologation"); seen.push(id); return { retryable: false }; } });
  await dispatcher.consume(a.merchantId, work[0]!.payload);
  assert.equal(seen[0], (work[0]!.payload as { intentId: string }).intentId);
});

test("TINY-08 wrong, foreign, disconnected and missing capabilities never enqueue work", async () => {
  const a = await arrange(), foreign = await arrange();
  const wrong = new URL(a.url); wrong.searchParams.set("key", "a".repeat(43));
  assert.equal((await a.notify({}, wrong)).status, 401);
  const swapped = new URL(a.url); swapped.pathname = foreign.url.pathname;
  assert.equal((await a.notify({}, swapped)).status, 401);
  const absent = new URL(a.url); absent.search = ""; assert.equal((await a.notify({}, absent)).status, 401);
  assert.equal((await a.request("GET", foreign.connection.id)).status, 404);
  assert.equal((await a.request("POST", a.connection.id, { environment: "homologation" }, "")).status, 401);
  const staff = await actor(a.merchantId, "staff"); assert.equal((await a.request("POST", a.connection.id, { environment: "homologation" }, staff)).status, 403);
  await f.prisma.fiscalConnection.update({ where: { id: a.connection.id }, data: { disconnectedAt: new Date() } });
  assert.equal((await a.notify()).status, 401);
  assert.equal((await events(a.merchantId)).length, 0); assert.equal((await events(foreign.merchantId)).length, 0);
});

test("TINY-08 persistence failure does not acknowledge notification receipt and retries safely", async () => {
  const a = await arrange();
  await f.sql.query(`CREATE FUNCTION fail_olist_hint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.merchant_id = '${a.merchantId}' AND NEW.event_type = 'fiscal.olist.notification.received' THEN RAISE EXCEPTION 'synthetic durable enqueue failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER fail_olist_hint BEFORE INSERT ON outbox_messages FOR EACH ROW EXECUTE FUNCTION fail_olist_hint()`);
  try { assert.equal((await a.notify()).status, 503); assert.equal((await events(a.merchantId)).length, 0); }
  finally { await f.sql.query("DROP TRIGGER fail_olist_hint ON outbox_messages; DROP FUNCTION fail_olist_hint()"); }
  assert.equal((await a.notify()).status, 200); assert.equal((await events(a.merchantId)).length, 1);
});

test("TINY-05 rotating OAuth tokens preserves the configured notification URL", async () => {
  const a = await arrange();
  const row = await f.prisma.fiscalConnection.findUniqueOrThrow({ where: { id: a.connection.id } });
  const before = JSON.parse(cipher.decrypt(row.credentialCipher!)); before.expiresAt = new Date(0).toISOString();
  await f.prisma.fiscalConnection.update({ where: { id: row.id }, data: { credentialCipher: cipher.encrypt(JSON.stringify(before)) } });
  let requests = 0;
  const reader = new FiscalErpCredentials(f.prisma, cipher, { resolve: async () => null }, (async (url, init) => {
    requests++; assert.equal(String(url), "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token");
    const form = new URLSearchParams(String(init?.body)); assert.equal(form.get("grant_type"), "refresh_token"); assert.equal(form.get("refresh_token"), credential.refreshToken);
    return Response.json({ access_token: "rotated-private-access", refresh_token: "rotated-private-refresh", expires_in: 14400 });
  }) as typeof fetch);
  assert.equal(await reader.credential({ merchantId: a.merchantId, environment: a.environment, provider: "tiny", connectionId: a.connection.id, issuerTaxId: a.connection.issuerTaxId }), "rotated-private-access");
  assert.equal(requests, 1);
  const after = await f.prisma.fiscalConnection.findUniqueOrThrow({ where: { id: row.id } });
  const value = JSON.parse(cipher.decrypt(after.credentialCipher!));
  assert.equal(value.notificationToken, before.notificationToken); assert.equal(value.refreshToken, "rotated-private-refresh");
  assert.equal((await a.notify()).status, 200);
});

test("TINY-06 later accepted notifications retain work before and after consumption in the same minute", async t => {
  for (const order of ["after_consume", "before_consume"] as const) {
    const a = await arrange(); const minute = Math.ceil(Date.now() / 60000) * 60000;
    t.mock.timers.enable({ apis: ["Date"], now: minute + 1000 });
    try {
      await f.prisma.fiscalIntent.update({ where: { id: a.intent.id }, data: { createdAt: new Date(minute) } });
      const handled = new Set<string>();
      const drain = async () => {
        for (const row of await events(a.merchantId)) if (!handled.has(row.eventId)) { await notifications.consume(a.merchantId, row.payload); handled.add(row.eventId); }
      };
      assert.equal((await a.notify()).status, 200);
      if (order === "after_consume") await drain();
      const late = await seedFiscalSale(f, { provider: "tiny", merchantId: a.merchantId, connectionId: a.connection.id });
      await f.prisma.fiscalIntent.update({ where: { id: late.intent.id }, data: { state: "processing", createdAt: new Date(minute + 2000) } });
      t.mock.timers.setTime(minute + 3000);
      assert.equal((await a.notify()).status, 200);
      await drain();
      assert.equal((await events(a.merchantId)).length, order === "after_consume" ? 2 : 1);
      const work = await events(a.merchantId, "fiscal.reconciliation.requested");
      assert.equal(work.filter(row => (row.payload as { intentId: string }).intentId === late.intent.id).length, 1);
      assert.ok(work.some(row => (row.payload as { intentId: string }).intentId === a.intent.id));
    } finally { t.mock.timers.reset(); }
  }
});

test("TINY-05 a real administrator configures and uses notifications on the same scoped account", async () => {
  const a = await arrange(); const admin = await actor(a.merchantId, "admin");
  const response = await a.request("POST", a.connection.id, { environment: "homologation", rotate: true }, admin);
  assert.equal(response.status, 201);
  const value = await response.json() as { configured: boolean; notificationUrl: string };
  assert.equal(value.configured, true); const url = new URL(value.notificationUrl);
  assert.equal(url.pathname, a.url.pathname); assert.notEqual(url.searchParams.get("key"), a.url.searchParams.get("key"));
  const read = await a.request("GET", a.connection.id, undefined, admin); assert.equal(read.status, 200);
  assert.equal((await read.json() as { notificationUrl: string }).notificationUrl, url.toString());
  const row = await f.prisma.fiscalConnection.findUniqueOrThrow({ where: { id: a.connection.id } });
  assert.equal(row.merchantId, a.merchantId); assert.equal(row.environment, "homologation");
  assert.equal(JSON.parse(cipher.decrypt(row.credentialCipher!)).notificationToken, url.searchParams.get("key"));
  assert.equal((await a.notify()).status, 401); assert.equal((await a.notify({}, url)).status, 200);
  assert.equal((await events(a.merchantId)).length, 1);
});
