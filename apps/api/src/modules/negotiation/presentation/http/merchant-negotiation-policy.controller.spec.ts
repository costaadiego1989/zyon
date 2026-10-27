import "reflect-metadata";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Module, UnauthorizedException } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import { AuthGuard } from "../../../auth/presentation/auth.guard.js";
import { JwtService } from "../../../auth/domain/services/jwt.service.js";
import { AuthCookieService } from "../../../auth/domain/services/auth-cookie.service.js";
import { BillingPlanMeteringService, PlanLimitGuard } from "../../../payment/domain/billing-plan-guard.js";
import { MerchantNegotiationPolicyController } from "./merchant-negotiation-policy.controller.js";
import {
  GetMerchantNegotiationPolicyUseCase,
  UpsertMerchantNegotiationPolicyUseCase
} from "../../application/merchant-negotiation-policy.use-cases.js";
import { InMemoryNegotiationStore } from "../../infrastructure/in-memory-negotiation.store.js";

describe("MerchantNegotiationPolicyController", () => {
  it("allows every billing plan to read and save limits over HTTP, preserving authentication and tenant scope", async (t) => {
    const store = new InMemoryNegotiationStore();
    let plan: "starter" | "starter179" | "growth" | "scale" = "starter";
    const metering = new BillingPlanMeteringService({} as never);
    metering.getEffectivePlan = async () => plan;
    const jwt = {
      authenticate: async (token: string) => {
        const [role, merchantId] = token.split(":");
        if (!["owner", "admin", "staff"].includes(role) || !merchantId)
          throw new UnauthorizedException();
        return { role, merchantId, userId: "u", email: "test@example.com" };
      },
    };

    // Match the constructor metadata emitted by the production build; the
    // source-test loader omits it. Keep the real auth and billing guards.
    Reflect.defineMetadata("design:paramtypes", [GetMerchantNegotiationPolicyUseCase, UpsertMerchantNegotiationPolicyUseCase], MerchantNegotiationPolicyController);
    Reflect.defineMetadata("design:paramtypes", [JwtService, AuthCookieService], AuthGuard);
    Reflect.defineMetadata("design:paramtypes", [Reflector, BillingPlanMeteringService], PlanLimitGuard);
    @Module({
      controllers: [MerchantNegotiationPolicyController],
      providers: [
        { provide: GetMerchantNegotiationPolicyUseCase, useValue: new GetMerchantNegotiationPolicyUseCase(store) },
        { provide: UpsertMerchantNegotiationPolicyUseCase, useValue: new UpsertMerchantNegotiationPolicyUseCase(store) },
        { provide: JwtService, useValue: jwt },
        { provide: AuthCookieService, useValue: { read: () => undefined } },
        AuthGuard,
        { provide: BillingPlanMeteringService, useValue: metering },
        PlanLimitGuard,
      ],
    })
    class NegotiationPolicyHttpModule {}
    const app = await NestFactory.create(NegotiationPolicyHttpModule, { logger: false });
    t.after(() => app.close());
    await app.listen(0, "127.0.0.1");
    const url = `${await app.getUrl()}/merchant-negotiation-policy`;
    const policy = {
      enabled: true,
      global: { minOfferDiscountPercent: 1, maxDiscountPercent: 8 },
      maxRounds: 2,
      estimatedCostPerAiCallCents: 1,
    };
    const request = (method: string, token?: string, body?: unknown) => fetch(url, {
      method,
      headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    for (const key of ["starter", "starter179", "growth", "scale"] as const) {
      plan = key;
      const token = `owner:m_${key}`;
      const saved = await request("PUT", token, { ...policy, merchantId: "other_store" });
      assert.equal(saved.status, 200, `${key} must be able to save negotiation limits`);
      assert.deepEqual((await saved.json()).policy.global, policy.global);
      const loaded = await request("GET", token);
      assert.equal(loaded.status, 200);
      assert.equal((await loaded.json()).has_custom_policy, true);
      assert.ok((await store.getMerchantPolicy(`m_${key}`))?.enabled);
    }
    assert.equal(await store.getMerchantPolicy("other_store"), null);
    const untouched = await request("GET", "owner:other_store");
    assert.equal((await untouched.json()).has_custom_policy, false);
    assert.equal((await request("GET")).status, 401);
    assert.equal((await request("PUT", undefined, policy)).status, 401);
    assert.equal((await request("PUT", "staff:m_starter", policy)).status, 403);
    assert.equal((await request("PUT", "owner:m_starter", {
      ...policy, global: { minOfferDiscountPercent: 9, maxDiscountPercent: 2 },
    })).status, 400);
    assert.deepEqual((await store.getMerchantPolicy("m_starter"))?.global, policy.global);
  });

  it("scopes upsert to JWT merchant", async () => {
    const store = new InMemoryNegotiationStore();
    const getPolicy = new GetMerchantNegotiationPolicyUseCase(store);
    const upsert = new UpsertMerchantNegotiationPolicyUseCase(store);
    const c = new MerchantNegotiationPolicyController(getPolicy, upsert);

    await c.put(
      { user: { merchantId: "m_jwt", userId: "u", email: "e", role: "owner" } },
      {
        merchantId: "m_evil",
        enabled: true,
        global: { minOfferDiscountPercent: 1, maxDiscountPercent: 5 },
        maxRounds: 2,
        estimatedCostPerAiCallCents: 1
      }
    );

    const row = await store.getMerchantPolicy("m_jwt");
    assert.ok(row?.enabled);

    const other = await store.getMerchantPolicy("m_evil");
    assert.equal(other, null);
  });

  // Bug 8 regression: GET must issue exactly one DB read, not two
  it("[Bug 8] GET policy hits store exactly once (no duplicate reads)", async () => {
    const store = new InMemoryNegotiationStore();
    let readCount = 0;
    const origGet = store.getMerchantPolicy.bind(store);
    store.getMerchantPolicy = async (merchantId: string) => {
      readCount++;
      return origGet(merchantId);
    };

    const getPolicy = new GetMerchantNegotiationPolicyUseCase(store);
    const upsert = new UpsertMerchantNegotiationPolicyUseCase(store);
    const c = new MerchantNegotiationPolicyController(getPolicy, upsert);

    // GET with no stored policy → returns default, has_custom_policy=false, single read
    readCount = 0;
    const res1 = await c.get({ user: { merchantId: "m1", userId: "u", email: "e", role: "owner" } });
    assert.equal(readCount, 1, "GET without stored policy must read store exactly once");
    assert.equal(res1.has_custom_policy, false);
    assert.ok(res1.policy, "resolved policy must be returned");

    // Seed a policy, then GET again
    await store.upsertMerchantPolicy("m1", {
      enabled: true,
      global: { minOfferDiscountPercent: 2, maxDiscountPercent: 10 },
      maxRounds: 3,
      estimatedCostPerAiCallCents: 5
    });

    readCount = 0;
    const res2 = await c.get({ user: { merchantId: "m1", userId: "u", email: "e", role: "owner" } });
    assert.equal(readCount, 1, "GET with stored policy must read store exactly once");
    assert.equal(res2.has_custom_policy, true);
    assert.equal(res2.policy.enabled, true);
  });

  // Bug 8 regression: PUT re-reads exactly once after upsert
  it("[Bug 8] PUT policy re-reads store exactly once after upsert", async () => {
    const store = new InMemoryNegotiationStore();
    let readCount = 0;
    const origGet = store.getMerchantPolicy.bind(store);
    store.getMerchantPolicy = async (merchantId: string) => {
      readCount++;
      return origGet(merchantId);
    };

    const getPolicy = new GetMerchantNegotiationPolicyUseCase(store);
    const upsert = new UpsertMerchantNegotiationPolicyUseCase(store);
    const c = new MerchantNegotiationPolicyController(getPolicy, upsert);

    readCount = 0;
    const res = await c.put(
      { user: { merchantId: "m2", userId: "u", email: "e", role: "owner" } },
      {
        enabled: true,
        global: { minOfferDiscountPercent: 1, maxDiscountPercent: 8 },
        maxRounds: 2,
        estimatedCostPerAiCallCents: 2
      }
    );
    assert.equal(readCount, 1, "PUT must re-read store exactly once after upsert");
    assert.equal(res.policy.enabled, true);
  });
});
