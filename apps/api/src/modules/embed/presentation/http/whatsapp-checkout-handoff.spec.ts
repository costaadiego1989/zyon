import test from "node:test";
import assert from "node:assert/strict";
import { EmbedCheckoutController, EmbedCheckoutGuardHelper } from "./embed-checkout.controller.js";
import { embedCheckoutSessionId } from "../../domain/embed-checkout-session.js";
import { InMemoryCheckoutRepository } from "../../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession } from "../../../checkout/__tests__/checkout-test-fixtures.js";

test("a WhatsApp checkout handoff retains only the persisted phone proof and ignores forged buyer identity", async () => {
  const claims = { typ: "aacp_embed_v1" as const, merchantId: "m1", nonce: "capability", issuedAtUnix: 1, expiresAtUnix: 9999999999, whatsappCheckoutSessionId: "wa_checkout_existing" };
  assert.equal(embedCheckoutSessionId(claims), "wa_checkout_existing");
  const repo = new InMemoryCheckoutRepository();
  const original = checkoutSession({ merchantId: "m1", sessionId: "wa_checkout_existing", globalUserId: "verified-wa-buyer",
    customer: { phone: "552171191446", phone_verified: true, email: "unverified@example.com", email_verified: false, fullName: "Comprador" } });
  await repo.saveSession(original); let trusted: any;
  const controller = new EmbedCheckoutController({ execute: async (_input: any, context: any) => { trusted = context; return { session_id: original.sessionId }; } } as any,
    {} as any, {} as any, new EmbedCheckoutGuardHelper(repo), {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any);
  await controller.start({ embedClaims: claims }, { global_user_id: "forged", customer: { phone: "another", email_verified: true } } as any);
  assert.equal(trusted.trustedPhoneBuyer.globalUserId, original.globalUserId); assert.equal(trusted.trustedPhoneBuyer.phone, original.customer!.phone);
  assert.equal(trusted.trustedPhoneBuyer.email_verified, undefined);
  trusted = undefined;
  await assert.rejects(controller.start({ embedClaims: claims }, { session_id: "another-session" } as any), /binding_mismatch/);
  await assert.rejects(controller.start({ embedClaims: { ...claims, merchantId: "foreign" } }, {} as any));
  assert.equal(trusted, undefined);
  await repo.saveSession({ ...original, customer: { ...original.customer, phone_verified: false } });
  await assert.rejects(controller.start({ embedClaims: claims }, {} as any), /whatsapp_checkout_buyer_proof_required/);
});
