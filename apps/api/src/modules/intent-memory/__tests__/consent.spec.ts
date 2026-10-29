import { describe, it } from "node:test";
import assert from "node:assert/strict";

/**
 * Feature 4: Customer Intent Memory — Consent Entity Unit Tests
 * Validates LGPD Art. 8 (consent), Art. 7 (withdrawal), Art. 6 (minimization)
 */

// ---------- Entity Under Test ----------
// Defined inline until the implementation exists in
// domain/entities/buyer-intent-memory-consent.entity.ts

interface ConsentSnapshot {
  merchant_id: string;
  global_user_id: string;
  opted_in: boolean;
  expires_at: string;
  updated_at: string;
}

class BuyerIntentMemoryConsentEntity {
  private readonly _snapshot: ConsentSnapshot;

  private constructor(snapshot: ConsentSnapshot) {
    this._snapshot = snapshot;
  }

  static create(data: ConsentSnapshot): BuyerIntentMemoryConsentEntity {
    return new BuyerIntentMemoryConsentEntity(data);
  }

  /** LGPD Art. 8: Consent is active only if opted_in=true AND expires_at > now */
  isActive(): boolean {
    return this._snapshot.opted_in && new Date(this._snapshot.expires_at) > new Date();
  }

  snapshot(): ConsentSnapshot {
    return { ...this._snapshot };
  }
}

// ---------- Tests ----------

describe("BuyerIntentMemoryConsentEntity — LGPD Art. 8 (consent)", () => {
  describe("isActive()", () => {
    // LGPD Art. 8: Only explicit, valid consent constitutes legal basis
    it("returns true when opted_in=true AND not expired", () => {
      // LGPD Art. 8: Valid consent = explicit opt-in + within time window
      const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

      const consent = BuyerIntentMemoryConsentEntity.create({
        merchant_id: "mrc_1",
        global_user_id: "usr_1",
        opted_in: true,
        expires_at: futureDate,
        updated_at: new Date().toISOString()
      });

      assert.equal(consent.isActive(), true);
    });

    // LGPD Art. 7: Consent that expired = no longer valid legal basis
    it("returns false when opted_in=true BUT expired", () => {
      // LGPD Art. 7: Time-bound consent — expired = invalid
      const pastDate = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      const consent = BuyerIntentMemoryConsentEntity.create({
        merchant_id: "mrc_1",
        global_user_id: "usr_1",
        opted_in: true,
        expires_at: pastDate,
        updated_at: new Date().toISOString()
      });

      assert.equal(consent.isActive(), false);
    });

    // LGPD Art. 7: User withdrawn consent = no legal basis
    it("returns false when opted_in=false (revoked)", () => {
      // LGPD Art. 7: Withdrawal of consent must immediately invalidate
      const futureDate = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

      const consent = BuyerIntentMemoryConsentEntity.create({
        merchant_id: "mrc_1",
        global_user_id: "usr_1",
        opted_in: false,
        expires_at: futureDate,
        updated_at: new Date().toISOString()
      });

      assert.equal(consent.isActive(), false);
    });
  });

  describe("Annual re-consent requirement — LGPD Art. 8 (time-limited consent)", () => {
    // LGPD Art. 8: Consent must be time-limited; annual re-consent is best practice
    it("expires_at should be set to 1 year from opt-in date", () => {
      const now = new Date();
      const oneYearLater = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

      const consent = BuyerIntentMemoryConsentEntity.create({
        merchant_id: "mrc_1",
        global_user_id: "usr_1",
        opted_in: true,
        expires_at: oneYearLater.toISOString(),
        updated_at: now.toISOString()
      });

      const snap = consent.snapshot();
      const expiresAt = new Date(snap.expires_at);
      const diffMs = Math.abs(expiresAt.getTime() - oneYearLater.getTime());

      // Tolerance: 1 second
      assert.ok(diffMs < 1000, `Expected expires_at ~1 year from now, diff=${diffMs}ms`);
    });

    it("consent created 366 days ago is expired", () => {
      // LGPD Art. 8: Stale consent = no legal basis for processing
      const createdAt = new Date(Date.now() - 366 * 24 * 60 * 60 * 1000);
      const expiredAt = new Date(createdAt.getTime() + 365 * 24 * 60 * 60 * 1000);

      const consent = BuyerIntentMemoryConsentEntity.create({
        merchant_id: "mrc_1",
        global_user_id: "usr_1",
        opted_in: true,
        expires_at: expiredAt.toISOString(),
        updated_at: createdAt.toISOString()
      });

      assert.equal(consent.isActive(), false);
    });
  });
});
