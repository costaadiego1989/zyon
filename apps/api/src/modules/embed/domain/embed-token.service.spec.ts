import test from "node:test";
import assert from "node:assert/strict";
import { EmbedTokenService } from "./embed-token.service.js";

test("EmbedTokenService sign and verify embed claims", () => {
  const svc = new EmbedTokenService({ value: Buffer.from("unit-test-secret-32-characters-mm") });
  const now = Math.floor(Date.now() / 1000);
  const token = svc.sign({
    typ: "aacp_embed_v1",
    merchantId: "m1",
    issuedAtUnix: now,
    expiresAtUnix: now + 3600,
    nonce: "n1"
  });
  const v = svc.verify(token);
  assert.equal(v.merchantId, "m1");
});

test("EmbedTokenService rejects expired token", () => {
  const svc = new EmbedTokenService({ value: Buffer.from("unit-test-secret-32-characters-mm") });
  const now = Math.floor(Date.now() / 1000);
  const token = svc.sign({
    typ: "aacp_embed_v1",
    merchantId: "m1",
    issuedAtUnix: now - 100,
    expiresAtUnix: now - 1,
    nonce: "n2"
  });
  assert.throws(() => svc.verify(token), /embed_token_expired/);
});
