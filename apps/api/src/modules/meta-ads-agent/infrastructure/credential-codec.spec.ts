import assert from "node:assert/strict";
import { test } from "node:test";
import { CredentialCodec } from "./credential-codec.js";

test("credentials are encrypted with a fresh nonce and bound to their store", () => {
  const codec = new CredentialCodec(Buffer.alloc(32, 7).toString("base64"));
  const first = codec.encrypt("store-a", "scoped-provider-token"); const second = codec.encrypt("store-a", "scoped-provider-token");
  assert.notEqual(first, second); assert.equal(first.includes("scoped-provider-token"), false);
  assert.equal(codec.decrypt("store-a", first), "scoped-provider-token");
  assert.throws(() => codec.decrypt("store-b", first), { code: "meta_credential_invalid" });
  assert.throws(() => new CredentialCodec(Buffer.alloc(32, 8).toString("base64")).decrypt("store-a", first), { code: "meta_credential_invalid" });
  const pieces = first.split("."); pieces[3] = Buffer.from("tampered").toString("base64url");
  assert.throws(() => codec.decrypt("store-a", pieces.join(".")), { code: "meta_credential_invalid" });
});
test("missing or invalid encryption keys fail closed without exposing input", () => {
  assert.throws(() => new CredentialCodec(undefined).encrypt("store-a", "secret"), { code: "meta_credential_key_missing" });
  for (const key of ["", "bad-key", Buffer.alloc(16).toString("base64")]) assert.throws(() => new CredentialCodec(key), { code: "meta_credential_key_invalid" });
  const codec = new CredentialCodec(Buffer.alloc(32, 1).toString("base64"));
  for (const ciphertext of ["", "plain-secret", "mga1.a.b.c", "mga2.a.b.c"]) assert.throws(() => codec.decrypt("store-a", ciphertext), { code: "meta_credential_invalid" });
});
