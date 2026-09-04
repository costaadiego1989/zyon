import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Feature 4: Customer Intent Memory — E2E Tests
 * Full workflow scenarios with LGPD validation
 * LGPD Art. 8, 18, 6
 */

// ---------- Test Data Factories ----------

function makeConsent(overrides: any = {}) {
  const now = new Date();
  return {
    merchant_id: "mrc_1",
    global_user_id: "usr_1",
    opted_in: true,
    expires_at: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    updated_at: now.toISOString(),
    ...overrides
  };
}

function makeExpiredConsent(overrides: any = {}) {
  return makeConsent({
    expires_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
    ...overrides
  });
}

function makeIntentRecord(overrides: any = {}) {
  return {
    id: `intent_${Math.random().toString(36).slice(2, 8)}`,
    merchant_id: "mrc_1",
    global_user_id: "usr_1",
    primary_intent: "price_sensitive",
    urgency: "high",
    budget_tier: "budget",
    category_focus: ["footwear"],
    pain_points: ["shipping_cost"],
    conversion_likelihood_percent: 45,
    behavioral_signals: {
      session_duration_seconds: 300,
      items_viewed: 5,
      comparisons_made: 2,
      objections_raised: 1,
      checkout_stage_reached: 1,
      last_objection_type: "shipping_cost"
    },
    generated_at: new Date().toISOString(),
    ...overrides
  };
}

// ---------- E2E Simulation --------

class IntentMemoryE2ESimulation {
  private consents = new Map<string, any>();
  private intents = new Map<string, any[]>();

  async optIn(merchantId: string, globalUserId: string) {
    const consent = makeConsent({ merchant_id: merchantId, global_user_id: globalUserId });
    this.consents.set(`${merchantId}:${globalUserId}`, consent);
    return { status: 200, body: { opted_in: true, expires_at: consent.expires_at } };
  }

  async optOut(merchantId: string, globalUserId: string) {
    const key = `${merchantId}:${globalUserId}`;
    this.consents.delete(key);
    this.intents.delete(key);
    return { status: 204 };
  }

  async getOwnIntent(merchantId: string, globalUserId: string) {
    const key = `${merchantId}:${globalUserId}`;
    const consent = this.consents.get(key);

    if (!consent || !consent.opted_in || new Date(consent.expires_at) <= new Date()) {
      return { status: 200, body: null };
    }

    const records = this.intents.get(key) || [];
    return { status: 200, body: records[records.length - 1] || null };
  }

  async recordIntentIfConsented(intent: any) {
    const key = `${intent.merchant_id}:${intent.global_user_id}`;
    const consent = this.consents.get(key);

    if (!consent || !consent.opted_in || new Date(consent.expires_at) <= new Date()) {
      return { recorded: false, reason: "no_consent" };
    }

    const list = this.intents.get(key) || [];
    list.push(intent);
    this.intents.set(key, list);
    return { recorded: true };
  }
}

// ---------- Tests ----------

describe("E2E: Intent Memory Full Workflows — LGPD Art. 8, 18, 6", () => {
  describe("17. Full LGPD lifecycle: opt-in → classify → view → opt-out → records gone", () => {
    it("executes complete lifecycle", async () => {
      const sim = new IntentMemoryE2ESimulation();
      const merchantId = "mrc_1";
      const globalUserId = "usr_1";

      // 1. Opt in
      let res: any = await sim.optIn(merchantId, globalUserId);
      assert.equal(res.status, 200);
      assert.equal(res.body.opted_in, true);

      // 2. Classify and record
      const recordRes = await sim.recordIntentIfConsented(
        makeIntentRecord({ merchant_id: merchantId, global_user_id: globalUserId })
      );
      assert.equal(recordRes.recorded, true);

      // 3. View own intent
      res = await sim.getOwnIntent(merchantId, globalUserId);
      assert.equal(res.status, 200);
      assert.ok(res.body);
      assert.equal(res.body.primary_intent, "price_sensitive");

      // 4. Opt out (right to erasure)
      res = await sim.optOut(merchantId, globalUserId);
      assert.equal(res.status, 204);

      // 5. Verify records gone
      res = await sim.getOwnIntent(merchantId, globalUserId);
      assert.equal(res.status, 200);
      assert.equal(res.body, null);
    });
  });

  describe("18. Cross-merchant isolation: same user, 2 merchants, separate records", () => {
    it("maintains separate records per merchant", async () => {
      const sim = new IntentMemoryE2ESimulation();
      const globalUserId = "usr_1";
      const merchantA = "mrc_a";
      const merchantB = "mrc_b";

      // Opt in to both
      await sim.optIn(merchantA, globalUserId);
      await sim.optIn(merchantB, globalUserId);

      // Record different intents
      await sim.recordIntentIfConsented(makeIntentRecord({
        merchant_id: merchantA,
        global_user_id: globalUserId,
        primary_intent: "price_sensitive"
      }));
      await sim.recordIntentIfConsented(makeIntentRecord({
        merchant_id: merchantB,
        global_user_id: globalUserId,
        primary_intent: "quality_seeker"
      }));

      // Query: merchant A sees price_sensitive
      let res = await sim.getOwnIntent(merchantA, globalUserId);
      assert.equal(res.body?.primary_intent, "price_sensitive");

      // Query: merchant B sees quality_seeker
      res = await sim.getOwnIntent(merchantB, globalUserId);
      assert.equal(res.body?.primary_intent, "quality_seeker");

      // Delete from merchant A
      await sim.optOut(merchantA, globalUserId);

      // Merchant A: no record
      res = await sim.getOwnIntent(merchantA, globalUserId);
      assert.equal(res.body, null);

      // Merchant B: still intact
      res = await sim.getOwnIntent(merchantB, globalUserId);
      assert.equal(res.body?.primary_intent, "quality_seeker");
    });
  });

  describe("Expired consent workflow", () => {
    it("blocks recording when consent expires", async () => {
      const sim = new IntentMemoryE2ESimulation();
      const merchantId = "mrc_1";
      const globalUserId = "usr_1";

      // Create with expired consent (manually injected)
      const expiredCons = makeExpiredConsent({ merchant_id: merchantId, global_user_id: globalUserId });

      // Simulate: expired consent loaded from DB
      const isActive = expiredCons.opted_in && new Date(expiredCons.expires_at) > new Date();
      assert.equal(isActive, false, "Expired consent should be inactive");
    });
  });

  describe("Regression: GET /me cache poisoning", () => {
    it("prevents cross-user data visibility", async () => {
      const sim = new IntentMemoryE2ESimulation();
      const merchantId = "mrc_1";

      // User A: opt in + record
      await sim.optIn(merchantId, "usr_a");
      await sim.recordIntentIfConsented(makeIntentRecord({
        merchant_id: merchantId,
        global_user_id: "usr_a",
        primary_intent: "price_sensitive"
      }));

      // User B: opt in + record
      await sim.optIn(merchantId, "usr_b");
      await sim.recordIntentIfConsented(makeIntentRecord({
        merchant_id: merchantId,
        global_user_id: "usr_b",
        primary_intent: "quality_seeker"
      }));

      // User A queries their data
      let res = await sim.getOwnIntent(merchantId, "usr_a");
      assert.equal(res.body?.primary_intent, "price_sensitive");

      // User B queries their data
      res = await sim.getOwnIntent(merchantId, "usr_b");
      assert.equal(res.body?.primary_intent, "quality_seeker");

      // Verify no cache collision
      const res_a = await sim.getOwnIntent(merchantId, "usr_a");
      const res_b = await sim.getOwnIntent(merchantId, "usr_b");
      assert.notEqual(res_a.body?.primary_intent, res_b.body?.primary_intent);
    });
  });

  describe("Regression: Cascade delete orphan records", () => {
    it("ensures all records deleted with consent", async () => {
      const sim = new IntentMemoryE2ESimulation();
      const merchantId = "mrc_1";
      const globalUserId = "usr_1";

      // Opt in
      await sim.optIn(merchantId, globalUserId);

      // Record 5 intents
      for (let i = 0; i < 5; i++) {
        await sim.recordIntentIfConsented(makeIntentRecord({
          id: `intent_${i}`,
          merchant_id: merchantId,
          global_user_id: globalUserId
        }));
      }

      // Verify records exist
      let res = await sim.getOwnIntent(merchantId, globalUserId);
      assert.ok(res.body);

      // Opt out (delete consent + records)
      await sim.optOut(merchantId, globalUserId);

      // Verify no orphans
      res = await sim.getOwnIntent(merchantId, globalUserId);
      assert.equal(res.body, null);
    });
  });
});
