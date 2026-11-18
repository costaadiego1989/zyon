import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import type { AddressInfo } from "node:net";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AuthGuard } from "../../auth/presentation/auth.guard.js";
import { JwtService } from "../../auth/domain/services/jwt.service.js";
import { AuthCookieService } from "../../auth/domain/services/auth-cookie.service.js";
import { CashbackService } from "../application/cashback.service.js";
import { CashbackQueriesService } from "../application/cashback-queries.service.js";
import { CashbackMerchantController } from "./cashback.controllers.js";
import { CashbackErrorFilter } from "./cashback-error.filter.js";
import { cashbackConfigurationFixture, configurationRules as rules } from "../infrastructure/__tests__/cashback-configuration.fixture.js";

let f: Awaited<ReturnType<typeof cashbackConfigurationFixture>>;
let app: Awaited<ReturnType<typeof NestFactory.create>>;
let base: string;
before(async () => {
  f = await cashbackConfigurationFixture();
  // Token verification is controlled; the production AuthGuard, HTTP dispatch,
  // controller, service, transaction and database all execute normally.
  const jwt = { authenticate: async (token: string) => {
    if (!["owner-a", "admin-a", "owner-b", "staff-a"].includes(token)) throw Error("jwt_invalid_signature");
    return { merchantId: token === "owner-b" ? "merchant-b" : "merchant-a", userId: token,
      email: "qa@example.test", role: token === "staff-a" ? "staff" : token === "admin-a" ? "admin" : "owner" };
  } } as unknown as JwtService;
  Reflect.defineMetadata("design:paramtypes", [JwtService, AuthCookieService], AuthGuard);
  Reflect.defineMetadata("design:paramtypes", [CashbackService, CashbackQueriesService], CashbackMerchantController);
  @Module({ controllers: [CashbackMerchantController], providers: [
    { provide: CashbackService, useValue: f.service }, { provide: CashbackQueriesService, useValue: f.queries },
    { provide: JwtService, useValue: jwt }, { provide: AuthCookieService, useValue: new AuthCookieService("aacp_access_token", false) },
    AuthGuard, CashbackErrorFilter,
  ] }) class ConfigurationHttpModule {}
  app = await NestFactory.create(ConfigurationHttpModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}/dashboard/cashback/program`;
});
beforeEach(async () => {
  await f.reset();
  // A deliberate synthetic merchant choice, independent of global fallbacks.
  await f.db.query("INSERT INTO merchant_rules(merchant_id,max_discount_percent,minimum_margin_percent) VALUES('merchant-a',0,0),('merchant-b',0,0)");
});
after(async () => { await app?.close(); await f?.close(); });

async function request(method = "GET", body?: unknown, token: string | null = "owner-a", suffix = "") {
  const response = await fetch(base + suffix, { method, headers: { "content-type": "application/json",
    ...(token ? { authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}
const command = (expectedRevision: string, idempotencyKey: string) => ({ expectedRevision, idempotencyKey });
const receiptCount = async () => (await f.db.query("SELECT count(*)::int AS n FROM cashback_event_receipts")).rows[0].n;

test("merchant HTTP reads return a canonical revision bound to the authenticated store", async () => {
  const owner = await request(); const admin = await request("GET", undefined, "admin-a");
  const other = await request("GET", undefined, "owner-b");
  assert.equal(owner.status, 200); assert.equal(owner.body.merchantId, "merchant-a");
  assert.match(owner.body.configurationRevision, /^[a-f0-9]{64}$/);
  assert.equal(admin.body.configurationRevision, owner.body.configurationRevision);
  assert.equal(other.body.merchantId, "merchant-b");
  assert.notEqual(other.body.configurationRevision, owner.body.configurationRevision);
  assert.equal(owner.body.generalDiscountCapBps, 0);
});

test("merchant HTTP configuration rejects missing metadata and forged fields without writes", async () => {
  const initial = (await request()).body;
  for (const body of [{ rules }, { rules, expectedRevision: "invalid", idempotencyKey: "bad" },
    { rules, ...command(initial.configurationRevision, "" ) },
    { rules, ...command(initial.configurationRevision, "forged"), merchantId: "merchant-b" },
    { rules: { status: "active" }, ...command(initial.configurationRevision, "invalid-rules") }]) {
    assert.equal((await request("PATCH", body)).status, 400);
  }
  assert.equal((await request("POST", undefined, "owner-a", "/publish")).status, 400);
  assert.deepEqual((await request()).body, initial);
  assert.equal(await receiptCount(), 0);
});

test("merchant HTTP publication returns exactly the saved reviewed rules", async () => {
  const initial = (await request()).body;
  const saved = await request("PATCH", { rules, ...command(initial.configurationRevision, "save") });
  assert.equal(saved.status, 200); assert.deepEqual(saved.body.draft, rules); assert.equal(saved.body.status, "disabled");
  const published = await request("POST", command(saved.body.configurationRevision, "publish"), "owner-a", "/publish");
  assert.equal(published.status, 201); assert.equal(published.body.status, "active");
  assert.deepEqual(published.body.published, rules); assert.equal(published.body.version, 1);
  assert.deepEqual((await request()).body, published.body);
  assert.deepEqual((await f.db.query("SELECT rules,actor_id FROM cashback_rule_versions")).rows, [{ rules, actor_id: "owner-a" }]);
});

test("CBX-29 merchant HTTP rejects a stale publication with 409 and no version or receipt effect", async () => {
  const initial = (await request()).body;
  const reviewed = await request("PATCH", { rules, ...command(initial.configurationRevision, "first") });
  const changedRules = { ...rules, earnRateBps: 750 };
  const changed = await request("PATCH", { rules: changedRules, ...command(reviewed.body.configurationRevision, "second") }, "admin-a");
  const stale = await request("POST", command(reviewed.body.configurationRevision, "stale"), "owner-a", "/publish");
  assert.equal(stale.status, 409); assert.equal(stale.body.code, "cashback_configuration_changed");
  assert.deepEqual((await request()).body, changed.body);
  assert.equal(changed.body.status, "disabled"); assert.equal(changed.body.version, 0);
  assert.equal((await f.db.query("SELECT count(*)::int AS n FROM cashback_rule_versions")).rows[0].n, 0);
  assert.equal(await receiptCount(), 2);
});

test("merchant HTTP retains role authentication and cross-store configuration isolation", async () => {
  const initial = (await request()).body;
  for (const token of [null, "invalid", "staff-a"]) {
    const expectedStatus = token === "staff-a" ? 403 : 401;
    assert.equal((await request("GET", undefined, token)).status, expectedStatus);
    assert.equal((await request("PATCH", { rules, ...command(initial.configurationRevision, "denied") }, token)).status, expectedStatus);
  }
  const foreign = await request("PATCH", { rules, ...command(initial.configurationRevision, "foreign") }, "owner-b");
  assert.equal(foreign.status, 409); assert.equal((await request("GET", undefined, "owner-b")).body.draft, null);
  assert.deepEqual((await request()).body, initial); assert.equal(await receiptCount(), 0);
});

test("merchant HTTP replays the same stored result after a later configuration change", async () => {
  const initial = (await request()).body;
  const input = { rules: { earnRateBps: 500 }, ...command(initial.configurationRevision, "same-operation") };
  const saved = await request("PATCH", input);
  const later = await request("PATCH", { rules: { earnRateBps: 700 }, ...command(saved.body.configurationRevision, "later") });
  const replay = await request("PATCH", input);
  assert.equal(replay.status, 200); assert.deepEqual(replay.body, saved.body);
  assert.deepEqual((await request()).body, later.body);
  const changedInput = await request("PATCH", { ...input, rules: { earnRateBps: 600 } });
  assert.equal(changedInput.status, 409); assert.equal(changedInput.body.code, "cashback_idempotency_input_mismatch");
  assert.equal(await receiptCount(), 2);
});
