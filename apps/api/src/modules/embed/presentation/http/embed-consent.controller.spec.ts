import test from "node:test";
import assert from "node:assert/strict";
import { EmbedConsentController } from "./embed-consent.controller.js";
import { EmbedCheckoutGuardHelper } from "./embed-checkout.controller.js";
import { embedCheckoutSessionId } from "../../domain/embed-checkout-session.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";

test("consent uses token-bound session tenant/buyer and rejects borrowed identities", async () => {
  const claims = { typ: "aacp_embed_v1" as const, merchantId: "merchant-with-underscores_1", nonce: "consenting-buyer", issuedAtUnix: 1, expiresAtUnix: 9999999999 };
  const sessionId = embedCheckoutSessionId(claims);
  const repo = new InMemoryCheckoutRepository();
  repo.saveSession(checkoutSession({ merchantId: claims.merchantId, sessionId, globalUserId: "buyer-1" }));
  const saved: any[] = [];
  const controller = new EmbedConsentController({ async saveConsent(value: any) { saved.push(value); } } as never, new EmbedCheckoutGuardHelper(repo));
  const body = { session_id: sessionId, global_user_id: "buyer-1", opted_in: true };
  await assert.rejects(controller.recordConsent({ embedClaims: { ...claims, nonce: "other" } }, body), /embed_checkout_session_binding_mismatch/);
  await assert.rejects(controller.recordConsent({ embedClaims: claims }, { ...body, global_user_id: "victim" }), /consent_buyer_mismatch/);
  await assert.rejects(controller.recordConsent({ embedClaims: claims }, { ...body, opted_in: "false" } as never), /consent_fields_invalid/);
  assert.equal(saved.length, 0);
  await controller.recordConsent({ embedClaims: claims }, body);
  assert.equal(saved[0].merchant_id, claims.merchantId);
  assert.equal(saved[0].global_user_id, "buyer-1");
});

test("withdrawing consent requests erasure for the token-bound buyer", async () => {
  const claims = { typ: "aacp_embed_v1" as const, merchantId: "merchant-1", nonce: "buyer-1", issuedAtUnix: 1, expiresAtUnix: 9999999999 };
  const sessionId = embedCheckoutSessionId(claims);
  const checkoutRepo = new InMemoryCheckoutRepository();
  checkoutRepo.saveSession(checkoutSession({ merchantId: claims.merchantId, sessionId, globalUserId: "buyer-1" }));
  const deleted: Array<[string, string]> = [];
  const controller = new EmbedConsentController({
    async saveConsent() {},
    async deleteConsent(merchantId: string, globalUserId: string) { deleted.push([merchantId, globalUserId]); },
  } as never, new EmbedCheckoutGuardHelper(checkoutRepo));

  await controller.recordConsent(
    { embedClaims: claims },
    { session_id: sessionId, global_user_id: "buyer-1", opted_in: false },
  );
  assert.deepEqual(deleted, [[claims.merchantId, "buyer-1"]]);
});

test("campaign consent is merchant-bound, records evidence, and revocation uses the same buyer", async () => {
  const claims = { typ: "aacp_embed_v1" as const, merchantId: "merchant-1", nonce: "buyer-1", issuedAtUnix: 1, expiresAtUnix: 9999999999 };
  const sessionId = embedCheckoutSessionId(claims);
  const checkoutRepo = new InMemoryCheckoutRepository();
  checkoutRepo.saveSession(checkoutSession({ merchantId: claims.merchantId, sessionId, globalUserId: "buyer-1" }));
  const granted: any[] = []; const revoked: any[] = [];
  const controller = new EmbedConsentController({ async saveConsent() {}, async deleteConsent() {} } as never,
    new EmbedCheckoutGuardHelper(checkoutRepo), {
      async grant(input: any) { granted.push(input); },
      async revoke(input: any) { revoked.push(input); },
    } as never);
  const body = { session_id: sessionId, opted_in: true, channels: ["email", "whatsapp", "email"], policy_version: "campaign-v1" };
  await controller.recordCampaignConsent({ embedClaims: claims }, body);
  assert.deepEqual(granted[0].channels, ["email", "whatsapp"]);
  assert.equal(granted[0].merchantId, claims.merchantId);
  assert.equal(granted[0].globalUserId, "buyer-1");
  assert.equal(granted[0].evidence.checkoutSessionId, sessionId);
  await controller.recordCampaignConsent({ embedClaims: claims }, { ...body, opted_in: false });
  assert.equal(revoked[0].globalUserId, "buyer-1");
  await assert.rejects(controller.recordCampaignConsent({ embedClaims: claims }, { ...body, channels: ["sms"] } as never), /campaign_consent_fields_invalid/);
});

test("campaign consent readback is bound to the authenticated checkout session", async () => {
  const claims = { typ: "aacp_embed_v1" as const, merchantId: "merchant-1", nonce: "buyer-1", issuedAtUnix: 1, expiresAtUnix: 9999999999 };
  const sessionId = embedCheckoutSessionId(claims);
  const checkoutRepo = new InMemoryCheckoutRepository();
  checkoutRepo.saveSession(checkoutSession({ merchantId: claims.merchantId, sessionId, globalUserId: "buyer-1" }));
  const controller = new EmbedConsentController({ async saveConsent() {}, async deleteConsent() {} } as never,
    new EmbedCheckoutGuardHelper(checkoutRepo), {
      async grant() {}, async revoke() {},
      async getGrantedChannels(input: any) {
        assert.deepEqual(input, { merchantId: "merchant-1", globalUserId: "buyer-1" });
        return ["email"];
      },
    } as never);
  const response = await controller.getCampaignConsent({ embedClaims: claims }, sessionId);
  assert.deepEqual(response.channels, ["email"]);
  await assert.rejects(controller.getCampaignConsent({ embedClaims: claims }, "checkout-other"), /embed_checkout_session_binding_mismatch/);
});

test("campaign consent replacement accepts an empty selection and keeps the checkout identity", async () => {
  const claims = { typ: "aacp_embed_v1" as const, merchantId: "merchant-1", nonce: "buyer-1", issuedAtUnix: 1, expiresAtUnix: 9999999999 };
  const sessionId = embedCheckoutSessionId(claims);
  const checkoutRepo = new InMemoryCheckoutRepository();
  checkoutRepo.saveSession(checkoutSession({ merchantId: claims.merchantId, sessionId, globalUserId: "buyer-1" }));
  const replacements: any[] = [];
  const controller = new EmbedConsentController({ async saveConsent() {}, async deleteConsent() {} } as never,
    new EmbedCheckoutGuardHelper(checkoutRepo), {
      async grant() {}, async revoke() {}, async getGrantedChannels() { return []; },
      async replace(input: any) { replacements.push(input); },
    } as never);
  await controller.replaceCampaignConsent(
    { embedClaims: claims },
    { session_id: sessionId, channels: [], policy_version: "campaign-v1" },
  );
  assert.equal(replacements[0].merchantId, "merchant-1");
  assert.equal(replacements[0].globalUserId, "buyer-1");
  assert.deepEqual(replacements[0].channels, []);
});
