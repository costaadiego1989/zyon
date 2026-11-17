import assert from "node:assert/strict";
import test from "node:test";
import { Reflector } from "@nestjs/core";
import { IssueEmbedSessionUseCase } from "../application/issue-embed-session.use-case.js";
import { EmbedAuthGuard } from "../presentation/http/embed-auth.guard.js";
import { EMBED_REQUIRED_SCOPE_KEY } from "../presentation/http/embed-scope.decorator.js";
import { EmbedTokenService, type EmbedScope, type EmbedTokenClaims } from "./embed-token.service.js";
import { embedCheckoutSessionId } from "./embed-checkout-session.js";
import { embedAppointmentConfirmationScope } from "./embed-appointment-confirmation-scope.js";

const SCOPE: EmbedScope = "appointments:confirm";
const tokens = new EmbedTokenService({ value: Buffer.from("synthetic-appointment-scope-unit-secret") });
const origin = "https://synthetic-booking.example.test";
const signed = (extra: Partial<EmbedTokenClaims> = {}) => tokens.sign({ typ: "aacp_embed_v1", merchantId: "services",
  issuedAtUnix: Math.floor(Date.now() / 1000), expiresAtUnix: Math.floor(Date.now() / 1000) + 600,
  nonce: "synthetic-booking-nonce", allowedOrigin: origin, scopes: [SCOPE], ...extra });
function guard(token: string, required: EmbedScope, requestOrigin?: string) {
  const handler = () => {}, reflector = new Reflector();
  Reflect.defineMetadata(EMBED_REQUIRED_SCOPE_KEY, required, handler);
  const request = { headers: { "x-aacp-embed-token": token, ...(requestOrigin ? { origin: requestOrigin } : {}) } };
  const context = { getHandler: () => handler, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => request }) } as unknown as Parameters<EmbedAuthGuard["canActivate"]>[0];
  return () => new EmbedAuthGuard(tokens, reflector).canActivate(context);
}

test("T30 capability", async t => {
  await t.test("the actual issuer grants only an explicitly requested appointment scope", () => {
    const issued = new IssueEmbedSessionUseCase(tokens).execute({ merchantId: "services", ttlSeconds: 600,
      allowedOrigin: origin, scopes: [SCOPE] });
    const claims = tokens.verify(issued.embed_session_token), scope = embedAppointmentConfirmationScope(claims);
    assert.deepEqual(claims.scopes, [SCOPE]);
    assert.deepEqual(scope, { merchantId: "services", sessionId: embedCheckoutSessionId(claims),
      expiresAtUnix: claims.expiresAtUnix, allowedOrigin: origin, scope: SCOPE });
    assert.equal(guard(issued.embed_session_token, SCOPE, origin)(), true);
  });
  await t.test("the actual issuer refuses appointment capability without an origin", () => {
    assert.throws(() => new IssueEmbedSessionUseCase(tokens).execute({ merchantId: "services", ttlSeconds: 600,
      scopes: [SCOPE] }), /embed_allowed_origin_required_for_transactional_scopes/);
  });
  await t.test("guard independently refuses a signed transactional token without origin binding", () => {
    assert.throws(guard(signed({ allowedOrigin: undefined }), SCOPE, origin), /embed_origin_binding_required_for_transactional_scopes/);
  });
  await t.test("a matching signature cannot replace the actual allowed request origin", () => {
    assert.throws(guard(signed(), SCOPE, "https://foreign.example.test"), /embed_origin_not_allowed/);
    assert.throws(guard(signed(), SCOPE), /embed_origin_not_allowed/);
  });
  await t.test("checkout track alone cannot authorize final confirmation", () => {
    const token = signed({ scopes: ["checkout:track"] });
    assert.throws(guard(token, SCOPE, origin), /embed_scope_not_granted/);
    assert.throws(() => embedAppointmentConfirmationScope(tokens.verify(token)), /embed_service_confirmation_scope_required/);
    assert.equal(guard(token, "checkout:track", origin)(), true);
  });
  await t.test("legacy tokens without scopes receive no new confirmation grant", () => {
    const token = signed({ scopes: undefined });
    assert.throws(guard(token, SCOPE, origin), /embed_scope_not_granted/);
    assert.throws(() => embedAppointmentConfirmationScope(tokens.verify(token)), /embed_service_confirmation_scope_required/);
    const issued = new IssueEmbedSessionUseCase(tokens).execute({ merchantId: "services", ttlSeconds: 600, allowedOrigin: origin });
    assert.equal(tokens.verify(issued.embed_session_token).scopes, undefined);
  });
  await t.test("development bypass cannot become a final appointment capability", () => {
    assert.throws(() => embedAppointmentConfirmationScope(tokens.verify(signed({ nonce: "dev_bypass" }))),
      /embed_service_confirmation_scope_required/);
  });
  await t.test("malformed capability expiry and identity are refused before transaction work", () => {
    const verified = tokens.verify(signed());
    for (const extra of [{ expiresAtUnix: Number.NaN }, { expiresAtUnix: 0 }, { merchantId: "" }, { allowedOrigin: undefined }])
      assert.throws(() => embedAppointmentConfirmationScope({ ...verified, ...extra }), /embed_service_confirmation_capability_invalid/);
    assert.throws(guard(signed({ expiresAtUnix: Math.floor(Date.now() / 1000) - 1 }), SCOPE, origin), /embed_session_token_expired/);
  });
});
