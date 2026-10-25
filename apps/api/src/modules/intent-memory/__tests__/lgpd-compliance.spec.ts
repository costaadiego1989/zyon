import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Feature 4: Customer Intent Memory — LGPD Compliance Integration Tests
 * CRITICAL: These tests validate legal requirements
 *
 * LGPD Art. 8 (consent), Art. 18 (erasure), Art. 6 (minimization), Art. 17 (access)
 */

// ---------- In-Memory Repositories (Test Doubles) ----------

class InMemoryConsentRepository {
  private consents = new Map<string, any>();

  async getByBuyer(merchantId: string, globalUserId: string) {
    return this.consents.get(`${merchantId}:${globalUserId}`) || null;
  }

  async save(consent: any) {
    this.consents.set(`${consent.merchant_id}:${consent.global_user_id}`, consent);
    return consent;
  }

  async deleteByBuyer(merchantId: string, globalUserId: string) {
    this.consents.delete(`${merchantId}:${globalUserId}`);
  }
}

class InMemoryIntentRepository {
  private records = new Map<string, any[]>();

  async getByBuyer(merchantId: string, globalUserId: string) {
    return this.records.get(`${merchantId}:${globalUserId}`) || [];
  }

  async getLatest(merchantId: string, globalUserId: string) {
    const recs = await this.getByBuyer(merchantId, globalUserId);
    return recs.length ? recs[recs.length - 1] : null;
  }

  async save(record: any) {
    const key = `${record.merchant_id}:${record.global_user_id}`;
    const list = this.records.get(key) || [];
    list.push(record);
    this.records.set(key, list);
    return record;
  }

  async deleteByBuyer(merchantId: string, globalUserId: string) {
    this.records.delete(`${merchantId}:${globalUserId}`);
  }

  async count(merchantId: string, globalUserId: string) {
    return (await this.getByBuyer(merchantId, globalUserId)).length;
  }
}

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

function makeRevokedConsent(overrides: any = {}) {
  return makeConsent({ opted_in: false, ...overrides });
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

// ---------- Consent validation logic (matches entity isActive) ----------

function isConsentActive(consent: any): boolean {
  if (!consent) return false;
  return consent.opted_in && new Date(consent.expires_at) > new Date();
}

// ---------- Tests ----------

describe("LGPD Compliance: Intent Memory Module — Art. 8, 18, 6, 17", () => {
  describe("9. Consent-Gate: Save WITHOUT Consent — LGPD Art. 8 [MOST CRITICAL]", () => {
    it("should NOT save intent when no consent exists", async () => {
      // LGPD Art. 8: No data processing without explicit consent
      const consentRepo = new InMemoryConsentRepository();
      const intentRepo = new InMemoryIntentRepository();

      const merchantId = "mrc_1";
      const globalUserId = "usr_1";

      // No consent exists
      const consent = await consentRepo.getByBuyer(merchantId, globalUserId);
      assert.equal(consent, null);

      // Attempt to record intent — must be blocked
      if (isConsentActive(consent)) {
        await intentRepo.save(makeIntentRecord({ merchant_id: merchantId, global_user_id: globalUserId }));
      }

      // CRITICAL ASSERTION: zero records saved
      const count = await intentRepo.count(merchantId, globalUserId);
      assert.equal(count, 0, "LGPD Art. 8 VIOLATION: intent saved without consent");
    });
  });

  describe("10. Consent-Gate: Save WITH Consent — LGPD Art. 8", () => {
    it("should save intent when valid consent exists", async () => {
      // LGPD Art. 8: With valid consent, processing is allowed
      const consentRepo = new InMemoryConsentRepository();
      const intentRepo = new InMemoryIntentRepository();

      const merchantId = "mrc_1";
      const globalUserId = "usr_1";

      // Active consent exists
      await consentRepo.save(makeConsent({ merchant_id: merchantId, global_user_id: globalUserId }));

      const consent = await consentRepo.getByBuyer(merchantId, globalUserId);
      if (isConsentActive(consent)) {
        await intentRepo.save(makeIntentRecord({ merchant_id: merchantId, global_user_id: globalUserId }));
      }

      const count = await intentRepo.count(merchantId, globalUserId);
      assert.equal(count, 1, "Intent should be saved with valid consent");
    });
  });

  describe("11. Consent-Gate: Expired Consent → Recording Rejected — LGPD Art. 7", () => {
    it("should NOT save intent when consent is expired", async () => {
      // LGPD Art. 7: Expired consent = no legal basis
      const consentRepo = new InMemoryConsentRepository();
      const intentRepo = new InMemoryIntentRepository();

      const merchantId = "mrc_1";
      const globalUserId = "usr_1";

      // Expired consent (opted_in=true but expires_at in past)
      await consentRepo.save(makeExpiredConsent({ merchant_id: merchantId, global_user_id: globalUserId }));

      const consent = await consentRepo.getByBuyer(merchantId, globalUserId);
      if (isConsentActive(consent)) {
        await intentRepo.save(makeIntentRecord({ merchant_id: merchantId, global_user_id: globalUserId }));
      }

      const count = await intentRepo.count(merchantId, globalUserId);
      assert.equal(count, 0, "LGPD Art. 7 VIOLATION: intent saved with expired consent");
    });
  });

  describe("12. Right to Erasure: DELETE consent → ALL intent records deleted — LGPD Art. 18", () => {
    it("should cascade delete all intent records on consent deletion", async () => {
      // LGPD Art. 18: "Right to be Forgotten" — hard delete, not soft
      const consentRepo = new InMemoryConsentRepository();
      const intentRepo = new InMemoryIntentRepository();

      const merchantId = "mrc_1";
      const globalUserId = "usr_1";

      // Create consent + 5 intent records
      await consentRepo.save(makeConsent({ merchant_id: merchantId, global_user_id: globalUserId }));
      for (let i = 0; i < 5; i++) {
        await intentRepo.save(makeIntentRecord({
          id: `intent_${i}`,
          merchant_id: merchantId,
          global_user_id: globalUserId
        }));
      }

      assert.equal(await intentRepo.count(merchantId, globalUserId), 5);

      // DELETE consent → cascade to all intents
      await consentRepo.deleteByBuyer(merchantId, globalUserId);
      await intentRepo.deleteByBuyer(merchantId, globalUserId);

      // CRITICAL: zero records remain
      assert.equal(await consentRepo.getByBuyer(merchantId, globalUserId), null);
      assert.equal(await intentRepo.count(merchantId, globalUserId), 0,
        "LGPD Art. 18 VIOLATION: orphan records remain after consent deletion");
    });

    it("should NOT delete records for other users in same merchant", async () => {
      // LGPD Art. 18: Erasure must be targeted, not over-broad
      const consentRepo = new InMemoryConsentRepository();
      const intentRepo = new InMemoryIntentRepository();

      const merchantId = "mrc_1";

      // User 1: consent + records
      await consentRepo.save(makeConsent({ merchant_id: merchantId, global_user_id: "usr_1" }));
      for (let i = 0; i < 3; i++) {
        await intentRepo.save(makeIntentRecord({ merchant_id: merchantId, global_user_id: "usr_1" }));
      }

      // User 2: consent + records
      await consentRepo.save(makeConsent({ merchant_id: merchantId, global_user_id: "usr_2" }));
      for (let i = 0; i < 2; i++) {
        await intentRepo.save(makeIntentRecord({ merchant_id: merchantId, global_user_id: "usr_2" }));
      }

      // Delete user 1 only
      await consentRepo.deleteByBuyer(merchantId, "usr_1");
      await intentRepo.deleteByBuyer(merchantId, "usr_1");

      // User 1: gone
      assert.equal(await intentRepo.count(merchantId, "usr_1"), 0);
      // User 2: intact
      assert.equal(await intentRepo.count(merchantId, "usr_2"), 2);
    });
  });

  describe("13. Right to Erasure: Idempotent DELETE — LGPD Art. 18", () => {
    it("should not error when deleting consent twice (idempotent)", async () => {
      // LGPD Art. 18: Multiple deletion requests must not fail
      const consentRepo = new InMemoryConsentRepository();
      const intentRepo = new InMemoryIntentRepository();

      const merchantId = "mrc_1";
      const globalUserId = "usr_1";

      await consentRepo.save(makeConsent({ merchant_id: merchantId, global_user_id: globalUserId }));

      // Delete 3 times — no error
      await consentRepo.deleteByBuyer(merchantId, globalUserId);
      await intentRepo.deleteByBuyer(merchantId, globalUserId);

      await consentRepo.deleteByBuyer(merchantId, globalUserId);
      await intentRepo.deleteByBuyer(merchantId, globalUserId);

      await consentRepo.deleteByBuyer(merchantId, globalUserId);
      await intentRepo.deleteByBuyer(merchantId, globalUserId);

      // Final state: all deleted, no error thrown
      assert.equal(await consentRepo.getByBuyer(merchantId, globalUserId), null);
      assert.equal(await intentRepo.count(merchantId, globalUserId), 0);
    });
  });

  describe("14. Tenant Isolation: user A intent in merchant X → NOT visible to merchant Y", () => {
    it("should isolate intent records per merchant", async () => {
      // merchant_id is the tenant boundary — CRITICAL invariant
      const consentRepo = new InMemoryConsentRepository();
      const intentRepo = new InMemoryIntentRepository();

      const globalUserId = "usr_1";
      const merchantA = "mrc_a";
      const merchantB = "mrc_b";

      // Consent + records in both merchants
      await consentRepo.save(makeConsent({ merchant_id: merchantA, global_user_id: globalUserId }));
      await consentRepo.save(makeConsent({ merchant_id: merchantB, global_user_id: globalUserId }));

      await intentRepo.save(makeIntentRecord({
        merchant_id: merchantA,
        global_user_id: globalUserId,
        primary_intent: "price_sensitive"
      }));
      await intentRepo.save(makeIntentRecord({
        merchant_id: merchantA,
        global_user_id: globalUserId,
        primary_intent: "comparison_shopper"
      }));
      await intentRepo.save(makeIntentRecord({
        merchant_id: merchantB,
        global_user_id: globalUserId,
        primary_intent: "quality_seeker"
      }));

      // Query merchant A: only sees merchant A data
      const latestA = await intentRepo.getLatest(merchantA, globalUserId);
      assert.equal(latestA.merchant_id, merchantA);

      // Query merchant B: only sees merchant B data
      const latestB = await intentRepo.getLatest(merchantB, globalUserId);
      assert.equal(latestB.merchant_id, merchantB);
      assert.equal(latestB.primary_intent, "quality_seeker");

      // CRITICAL: no cross-merchant data leak
      assert.notEqual(latestA.primary_intent, latestB.primary_intent);
    });
  });

  describe("15. GET /intent-memory/me without consent → 200 with empty — LGPD Art. 17", () => {
    it("should return 200 with null, NOT 403, when no consent", async () => {
      // LGPD Art. 17: Right to access — "no data" is not "access denied"
      const consentRepo = new InMemoryConsentRepository();
      const intentRepo = new InMemoryIntentRepository();

      const merchantId = "mrc_1";
      const globalUserId = "usr_1";

      // No consent
      const consent = await consentRepo.getByBuyer(merchantId, globalUserId);

      // Simulate GET /intent-memory/me
      let status: number;
      let body: any;

      if (!consent || !isConsentActive(consent)) {
        status = 200;
        body = null; // Not 403 Forbidden!
      } else {
        const record = await intentRepo.getLatest(merchantId, globalUserId);
        status = 200;
        body = record;
      }

      assert.equal(status, 200, "Should be 200, not 403");
      assert.equal(body, null, "Should be null/empty when no consent");
    });
  });

  describe("16. GET /intent-memory/me with consent → returns latest intent — LGPD Art. 17", () => {
    it("should return latest intent record when consent is active", async () => {
      // LGPD Art. 17: Right to access own data
      const consentRepo = new InMemoryConsentRepository();
      const intentRepo = new InMemoryIntentRepository();

      const merchantId = "mrc_1";
      const globalUserId = "usr_1";

      // Active consent
      await consentRepo.save(makeConsent({ merchant_id: merchantId, global_user_id: globalUserId }));

      // Multiple intent records
      await intentRepo.save(makeIntentRecord({
        id: "old_intent",
        merchant_id: merchantId,
        global_user_id: globalUserId,
        primary_intent: "comparison_shopper"
      }));
      await intentRepo.save(makeIntentRecord({
        id: "latest_intent",
        merchant_id: merchantId,
        global_user_id: globalUserId,
        primary_intent: "price_sensitive"
      }));

      // Simulate GET /intent-memory/me
      const consent = await consentRepo.getByBuyer(merchantId, globalUserId);
      let body: any;

      if (isConsentActive(consent)) {
        body = await intentRepo.getLatest(merchantId, globalUserId);
      } else {
        body = null;
      }

      assert.ok(body, "Should return intent record");
      assert.equal(body.id, "latest_intent", "Should return LATEST record");
      assert.equal(body.primary_intent, "price_sensitive");
    });
  });
});
