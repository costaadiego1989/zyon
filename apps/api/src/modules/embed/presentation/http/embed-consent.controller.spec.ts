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
