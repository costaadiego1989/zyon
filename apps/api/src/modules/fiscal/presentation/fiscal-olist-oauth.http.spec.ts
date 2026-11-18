import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { APP_FILTER } from "@nestjs/core";
import { ProblemDetailsSchema } from "@zyon/contracts";
import { ProblemDetailsFilter } from "../../../shared/http/problem-details.filter.js";
import type { PrismaClient } from "@prisma/client";
import { createFiscalFixture } from "../../../../tests/fiscal-fixture.js";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { AuthGuard } from "../../auth/presentation/auth.guard.js";
import { TenantRoleGuard } from "../../auth/presentation/tenant-role.guard.js";
import { JwtService } from "../../auth/domain/services/jwt.service.js";
import { AuthCookieService } from "../../auth/domain/services/auth-cookie.service.js";
import { PrismaAuthRepository } from "../../auth/infrastructure/prisma-auth.repository.js";
import { FiscalCredentialCipher } from "../infrastructure/fiscal-credential-cipher.js";
import { FiscalOlistOAuthService } from "../infrastructure/fiscal-olist-oauth.service.js";
import { FiscalOlistOAuthController, FiscalOlistOAuthCallbackController } from "./fiscal-olist-oauth.controller.js";
import { FISCAL_OLIST_OAUTH } from "../domain/fiscal-olist-oauth.port.js";

let f: Awaited<ReturnType<typeof createFiscalFixture>>, jwt: JwtService;
const cipher = new FiscalCredentialCipher({ AACP_PII_ENC_KEY: "local-only-olist-oauth-test" });
const issuer = "12ABC34501DE35";
const owners = { stockOwner: "zyon", emailOwner: "zyon", whatsappOwner: "zyon" };
const input = { environment: "homologation", issuerTaxId: issuer, clientId: "private-application-812", clientSecret: "private-application-secret", ...owners };
const calls: Array<{ url: string; init: RequestInit }> = [];
let returnedIssuer = issuer, tokenStatus = 200, networkFailure = false;
const fetcher = (async (url: RequestInfo | URL, init: RequestInit = {}) => {
  calls.push({ url: String(url), init });
  if (networkFailure) throw new Error("unknown network outcome");
  return String(url).endsWith("/token")
    ? Response.json({ access_token: "private-access-token", refresh_token: "private-refresh-token", expires_in: 14400, token_type: "Bearer" }, { status: tokenStatus })
    : Response.json({ cpfCnpj: returnedIssuer });
}) as typeof fetch;

before(async () => {
  f = await createFiscalFixture({ controllers: [FiscalOlistOAuthController, FiscalOlistOAuthCallbackController], providers: [AuthGuard, TenantRoleGuard,
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
    { provide: JwtService, useFactory: (p: PrismaClient) => (jwt = new JwtService("olist-fiscal-http-secret", 3600, new PrismaAuthRepository(p))), inject: [PRISMA_CLIENT] },
    { provide: AuthCookieService, useFactory: () => new AuthCookieService() },
    { provide: FISCAL_OLIST_OAUTH, useFactory: (p: PrismaClient) => new FiscalOlistOAuthService(p, cipher, { DASHBOARD_URL: "https://dashboard.example.test", API_PUBLIC_URL: "https://api.example.test" }, fetcher), inject: [PRISMA_CLIENT] },
  ] });
}, { timeout: 120000 });
after(async () => { await f?.close(); });

async function actor(role: "owner" | "admin" | "staff" = "owner", merchantId = f.tag + randomUUID()) {
  await f.prisma.merchant.upsert({ where: { id: merchantId }, create: { id: merchantId, name: "Local Olist fiscal merchant" }, update: {} });
  const user = await f.prisma.merchantUser.create({ data: { merchantId, email: randomUUID() + "@example.test", role } });
  await f.prisma.merchantTeamMember.create({ data: { merchantId, userId: user.id, role: role.toUpperCase() } });
  const token = await jwt.issue({ merchantId, userId: user.id, email: user.email, role });
  const request = (path: string, body?: unknown, auth = token) => fetch(f.first.url + "/v1/merchants/me/fiscal/olist/oauth/" + path, {
    method: body ? "POST" : "GET", headers: { ...(auth ? { authorization: "Bearer " + auth } : {}), "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { merchantId, user, request };
}
async function started() {
  calls.length = 0; returnedIssuer = issuer; tokenStatus = 200; networkFailure = false;
  const a = await actor(); const response = await a.request("authorize", input);
  assert.equal(response.status, 201);
  return { ...a, authorization: await response.json() as { state: string; url: string; redirectUri: string } };
}
const stateHash = (state: string) => createHash("sha256").update(state).digest("hex");

test("TINY-01 private application authorization is guarded, scoped, expiring and encrypted", async () => {
  const a = await started(); const url = new URL(a.authorization.url);
  assert.equal(url.origin + url.pathname, "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/auth");
  assert.equal(url.searchParams.get("client_id"), input.clientId);
  assert.equal(url.searchParams.get("scope"), "openid"); assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("redirect_uri"), "https://api.example.test/v1/webhooks/fiscal/olist/oauth/callback");
  assert.equal(new URL(url.searchParams.get("redirect_uri")!).hash, "");
  assert.equal(url.searchParams.get("state"), a.authorization.state); assert.match(a.authorization.state, /^[A-Za-z0-9_-]{43}$/);
  const row = await f.prisma.fiscalOlistOAuthSession.findUniqueOrThrow({ where: { stateHash: stateHash(a.authorization.state) } });
  assert.equal(row.merchantId, a.merchantId); assert.equal(row.actorId, a.user.id); assert.equal(row.environment, "homologation");
  assert.ok(row.expiresAt.getTime() > Date.now() + 590000 && row.expiresAt.getTime() <= Date.now() + 600000);
  assert.equal(JSON.stringify(row).includes(input.clientSecret), false); assert.equal(JSON.stringify(row).includes(a.authorization.state), false);
  assert.equal(calls.length, 0); assert.equal(await f.prisma.fiscalConnection.count({ where: { merchantId: a.merchantId } }), 0);
  assert.equal((await a.request("authorize", input, "")).status, 401);
  const staff = await actor("staff"); assert.equal((await staff.request("authorize", input)).status, 403);
  const admin = await actor("admin"); assert.equal((await admin.request("authorize", input)).status, 201);
});

test("TINY-02 authenticated code exchange binds issuer and stores a rotating v3 credential without activation", async () => {
  const a = await started(); const response = await a.request("complete", { environment: "homologation", state: a.authorization.state, code: "provider-code-321" });
  assert.equal(response.status, 201); const result = await response.json() as { connectionId: string };
  const connection = await f.prisma.fiscalConnection.findUniqueOrThrow({ where: { id: result.connectionId } });
  assert.equal(connection.provider, "tiny"); assert.equal(connection.merchantId, a.merchantId); assert.equal(connection.environment, "homologation");
  assert.equal(connection.issuerTaxId, issuer); assert.equal(connection.isActive, false); assert.deepEqual(connection.readiness, []);
  const secret = JSON.parse(cipher.decrypt(connection.credentialCipher!));
  assert.equal(secret.contract, "olist_oauth_v3"); assert.equal(secret.token, "private-access-token"); assert.equal(secret.refreshToken, "private-refresh-token");
  assert.equal(secret.clientId, input.clientId); assert.equal(secret.clientSecret, input.clientSecret); assert.equal(secret.issuerTaxId, issuer);
  assert.equal(secret.environment, "homologation"); assert.ok(Date.parse(secret.expiresAt) > Date.now() + 14390000);
  assert.equal(calls[0]!.url, "https://accounts.tiny.com.br/realms/tiny/protocol/openid-connect/token");
  assert.equal(calls[0]!.init.redirect, "manual"); const form = new URLSearchParams(String(calls[0]!.init.body));
  assert.equal(form.get("grant_type"), "authorization_code"); assert.equal(form.get("code"), "provider-code-321");
  assert.equal(form.get("client_id"), input.clientId); assert.equal(form.get("client_secret"), input.clientSecret); assert.equal(form.get("redirect_uri"), a.authorization.redirectUri);
  assert.equal(calls[1]!.url, "https://api.tiny.com.br/public-api/v3/info"); assert.equal(new Headers(calls[1]!.init.headers).get("authorization"), "Bearer private-access-token");
  const session = await f.prisma.fiscalOlistOAuthSession.findUniqueOrThrow({ where: { stateHash: stateHash(a.authorization.state) } });
  assert.ok(session.claimedAt); assert.ok(session.completedAt); assert.equal(session.credentialCipher, null); assert.equal(session.resultConnectionId, connection.id);
  assert.equal(JSON.stringify(result).includes("token"), false);
});

test("TINY-03 foreign merchant, actor and environment cannot consume an authorization state", async () => {
  const a = await started(); const foreign = await actor(), sameMerchant = await actor("owner", a.merchantId);
  for (const [who, environment] of [[foreign, "homologation"], [sameMerchant, "homologation"], [a, "production"]] as const) {
    assert.notEqual((await who.request("complete", { environment, state: a.authorization.state, code: "private-code" })).status, 201);
  }
  assert.equal(calls.length, 0); const row = await f.prisma.fiscalOlistOAuthSession.findUniqueOrThrow({ where: { stateHash: stateHash(a.authorization.state) } });
  assert.equal(row.claimedAt, null); assert.ok(row.credentialCipher);
});

test("TINY-03 expired, replayed and concurrent states never repeat a possibly consumed code", async () => {
  const expired = await started(); await f.prisma.fiscalOlistOAuthSession.update({ where: { stateHash: stateHash(expired.authorization.state) }, data: { expiresAt: new Date(0) } });
  assert.notEqual((await expired.request("complete", { environment: "homologation", state: expired.authorization.state, code: "code" })).status, 201); assert.equal(calls.length, 0);
  const a = await started(); const body = { environment: "homologation", state: a.authorization.state, code: "code" };
  const responses = await Promise.all([a.request("complete", body), a.request("complete", body)]);
  assert.equal(responses.filter(r => r.status === 201).length, 1); assert.equal(calls.length, 2);
  assert.notEqual((await a.request("complete", body)).status, 201); assert.equal(calls.length, 2);
});

test("TINY-03 mismatched issuer and unknown exchange outcome never replace an existing credential", async () => {
  for (const failure of ["issuer", "network"] as const) {
    const a = await started(); const connection = await f.prisma.fiscalConnection.create({ data: { merchantId: a.merchantId, environment: "homologation", provider: "tiny", issuerTaxId: issuer, credentialCipher: cipher.encrypt(JSON.stringify({ contract: "olist_oauth_v3", token: "existing" })) } });
    const start = await a.request("authorize", { ...input, connectionId: connection.id }); const authorization = await start.json() as { state: string };
    returnedIssuer = failure === "issuer" ? "12345678000195" : issuer; networkFailure = failure === "network";
    const body = { environment: "homologation", state: authorization.state, code: "uncertain-code" };
    assert.notEqual((await a.request("complete", body)).status, 201);
    assert.equal((await f.prisma.fiscalConnection.findUniqueOrThrow({ where: { id: connection.id } })).credentialCipher, connection.credentialCipher);
    const count = calls.length; assert.notEqual((await a.request("complete", body)).status, 201); assert.equal(calls.length, count);
  }
  networkFailure = false;
});

test("TINY-01 production OAuth session migration creates scoped storage and merchant foreign key", async () => {
  const sql = readFileSync(new URL("../../../../prisma/deploy-migrations/20261118140000_fiscal_olist_oauth/migration.sql", import.meta.url), "utf8");
  const client = await f.sql.connect();
  try {
    await client.query("BEGIN");
    await client.query('CREATE SCHEMA "' + f.schema + '_oauth_migration"');
    await client.query('SET LOCAL search_path TO "' + f.schema + '_oauth_migration", "' + f.schema + '"');
    await client.query(sql);
    const columns = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='fiscal_olist_oauth_sessions'", [f.schema + "_oauth_migration"]);
    assert.ok(columns.rows.some(row => row.column_name === "state_hash")); assert.ok(columns.rows.some(row => row.column_name === "credential_cipher"));
    await assert.rejects(client.query("INSERT INTO fiscal_olist_oauth_sessions (state_hash,merchant_id,actor_id,environment,expires_at) VALUES ($1,$2,$3,'homologation',NOW())", ["0".repeat(64), "foreign-missing-merchant", "owner"]), /foreign key/);
  } finally { await client.query("ROLLBACK"); client.release(); }
});

test("TINY-02 initial OAuth can recover a legacy credential while preserving connection identity", async () => {
  const a = await started();
  const connection = await f.prisma.fiscalConnection.create({ data: { merchantId: a.merchantId, environment: "homologation", provider: "tiny", issuerTaxId: issuer, credentialCipher: cipher.encrypt("legacy-manual-token") } });
  const response = await a.request("authorize", { ...input, connectionId: connection.id }); const authorization = await response.json() as { state: string };
  const complete = await a.request("complete", { environment: "homologation", state: authorization.state, code: "fresh-code" });
  assert.equal(complete.status, 201); assert.equal((await complete.json() as { connectionId: string }).connectionId, connection.id);
  const updated = await f.prisma.fiscalConnection.findUniqueOrThrow({ where: { id: connection.id } });
  assert.equal(JSON.parse(cipher.decrypt(updated.credentialCipher!)).contract, "olist_oauth_v3"); assert.equal(updated.isActive, false);
});

test("TINY-03 a credential changed after authorization starts cannot be overwritten by its old state", async () => {
  const a = await started();
  const connection = await f.prisma.fiscalConnection.create({ data: { merchantId: a.merchantId, environment: "homologation", provider: "tiny", issuerTaxId: issuer, credentialCipher: cipher.encrypt(JSON.stringify({ token: "first" })) } });
  const response = await a.request("authorize", { ...input, connectionId: connection.id }); const authorization = await response.json() as { state: string };
  const changed = cipher.encrypt(JSON.stringify({ token: "concurrent-authorized-credential" }));
  await f.prisma.fiscalConnection.update({ where: { id: connection.id }, data: { credentialCipher: changed } });
  assert.notEqual((await a.request("complete", { environment: "homologation", state: authorization.state, code: "code" })).status, 201);
  assert.equal((await f.prisma.fiscalConnection.findUniqueOrThrow({ where: { id: connection.id } })).credentialCipher, changed);
});

test("TINY-02 public callback only navigates to the bound environment without exchanging or consuming the code", async () => {
  for (const environment of ["homologation", "production"] as const) {
    const a = await started(); const startedResponse = await a.request("authorize", { ...input, environment });
    const authorization = await startedResponse.json() as { state: string; redirectUri: string };
    const uri = new URL(authorization.redirectUri); assert.equal(uri.hash, ""); assert.equal(uri.search, "");
    const response = await fetch(f.first.url + uri.pathname + "?" + new URLSearchParams({ state: authorization.state, code: "bridge-private-code", redirect_uri: "https://untrusted.invalid" }), { redirect: "manual" });
    assert.equal(response.status, 302); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(response.headers.get("referrer-policy"), "no-referrer");
    const target = new URL(response.headers.get("location")!);
    assert.equal(target.origin, "https://dashboard.example.test"); assert.equal(target.searchParams.get("code"), "bridge-private-code");
    assert.equal(target.searchParams.get("state"), authorization.state); assert.equal(target.hash, "#fiscal-settings?environment=" + environment);
    assert.equal(calls.length, 0);
    const row = await f.prisma.fiscalOlistOAuthSession.findUniqueOrThrow({ where: { stateHash: stateHash(authorization.state) } });
    assert.equal(row.claimedAt, null); assert.ok(row.credentialCipher);
  }
});

test("TINY-03 callback rejects unknown state and returns a bounded denial to the fixed dashboard", async () => {
  const a = await started(); const path = f.first.url + "/v1/webhooks/fiscal/olist/oauth/callback";
  assert.notEqual((await fetch(path + "?state=" + "a".repeat(43) + "&code=code", { redirect: "manual" })).status, 302);
  const response = await fetch(path + "?" + new URLSearchParams({ state: a.authorization.state, error: "access_denied", code: "must-not-forward" }), { redirect: "manual" });
  assert.equal(response.status, 302);
  const target = new URL(response.headers.get("location")!); assert.equal(target.origin, "https://dashboard.example.test");
  assert.equal(target.searchParams.get("error"), "access_denied"); assert.equal(target.searchParams.has("code"), false); assert.equal(calls.length, 0);
});

test("TINY-02 reauthorization preserves an active store and restores only an explicitly selected disconnected account", async () => {
  for (const prior of ["active", "disconnected"] as const) {
    const a = await started(); const activatedAt = new Date(Date.now() - 3600000);
    const credentialCipher = cipher.encrypt(JSON.stringify({ token: "previous", notificationToken: "n".repeat(43) }));
    const connection = await f.prisma.fiscalConnection.create({ data: { merchantId: a.merchantId, environment: "homologation", provider: "tiny", issuerTaxId: issuer, credentialCipher,
      isActive: prior === "active", activatedAt, disconnectedAt: prior === "disconnected" ? new Date() : null, stockOwner: "provider" } });
    const response = await a.request("authorize", { ...input, connectionId: connection.id }); const authorization = await response.json() as { state: string };
    const completed = await a.request("complete", { environment: "homologation", state: authorization.state, code: "renewed-code" });
    assert.equal(completed.status, 201); assert.equal((await completed.json() as { isActive: boolean }).isActive, prior === "active");
    const updated = await f.prisma.fiscalConnection.findUniqueOrThrow({ where: { id: connection.id } });
    assert.equal(updated.isActive, prior === "active"); assert.equal(updated.activatedAt!.getTime(), activatedAt.getTime());
    assert.equal(updated.disconnectedAt, null); assert.equal(updated.stockOwner, "provider"); assert.deepEqual(updated.readiness, []);
    assert.equal(JSON.parse(cipher.decrypt(updated.credentialCipher!)).notificationToken, "n".repeat(43));
  }
});

test("TINY-03 disconnecting during authorization revokes the pending state without replacing credentials", async () => {
  const a = await started(); const credentialCipher = cipher.encrypt(JSON.stringify({ token: "previous" }));
  const connection = await f.prisma.fiscalConnection.create({ data: { merchantId: a.merchantId, environment: "homologation", provider: "tiny", issuerTaxId: issuer, credentialCipher } });
  const response = await a.request("authorize", { ...input, connectionId: connection.id }); const authorization = await response.json() as { state: string };
  const disconnectedAt = new Date(); await f.prisma.fiscalConnection.update({ where: { id: connection.id }, data: { disconnectedAt } });
  assert.notEqual((await a.request("complete", { environment: "homologation", state: authorization.state, code: "late-code" })).status, 201);
  const current = await f.prisma.fiscalConnection.findUniqueOrThrow({ where: { id: connection.id } });
  assert.equal(current.disconnectedAt!.getTime(), disconnectedAt.getTime()); assert.equal(current.credentialCipher, credentialCipher);
});

test("TINY-03 real OAuth HTTP failures expose exact correction status and production Problem Details", async () => {
  async function check(response: Response, status: number, code: string) {
    assert.equal(response.status, status); assert.ok(response.headers.get("content-type")?.startsWith("application/problem+json"));
    const body = await response.json() as { status: number; code: string };
    assert.equal(body.status, status); assert.equal(body.code, code); assert.equal(ProblemDetailsSchema.safeParse(body).success, true);
  }
  {
    const a = await started(); await f.prisma.fiscalOlistOAuthSession.update({ where: { stateHash: stateHash(a.authorization.state) }, data: { expiresAt: new Date(0) } });
    await check(await a.request("complete", { environment: "homologation", state: a.authorization.state, code: "expired" }), 409, "fiscal_olist_authorization_expired_or_used"); assert.equal(calls.length, 0);
  }
  {
    const a = await started(); const body = { environment: "homologation", state: a.authorization.state, code: "once" };
    const first = await a.request("complete", body); assert.equal(first.status, 201);
    const result = await first.json() as { connectionId: string };
    const saved = await f.prisma.fiscalConnection.findUniqueOrThrow({ where: { id: result.connectionId } });
    await check(await a.request("complete", body), 409, "fiscal_olist_authorization_expired_or_used"); assert.equal(calls.length, 2);
    assert.equal((await f.prisma.fiscalConnection.findUniqueOrThrow({ where: { id: saved.id } })).credentialCipher, saved.credentialCipher);
  }
  for (const failure of ["issuer", "changed"] as const) {
    const a = await started(); const original = cipher.encrypt(JSON.stringify({ token: "original-private-access" }));
    const connection = await f.prisma.fiscalConnection.create({ data: { merchantId: a.merchantId, environment: "homologation", provider: "tiny", issuerTaxId: issuer, credentialCipher: original } });
    const start = await a.request("authorize", { ...input, connectionId: connection.id }); const authorization = await start.json() as { state: string };
    const retained = failure === "changed" ? cipher.encrypt(JSON.stringify({ token: "concurrent-private-access" })) : original;
    if (failure === "changed") await f.prisma.fiscalConnection.update({ where: { id: connection.id }, data: { credentialCipher: retained } });
    else returnedIssuer = "12345678000195";
    await check(await a.request("complete", { environment: "homologation", state: authorization.state, code: "failure-code" }), failure === "issuer" ? 400 : 409,
      failure === "issuer" ? "fiscal_olist_issuer_mismatch" : "fiscal_olist_connection_changed");
    assert.equal((await f.prisma.fiscalConnection.findUniqueOrThrow({ where: { id: connection.id } })).credentialCipher, retained); assert.equal(calls.length, 2);
  }
});
