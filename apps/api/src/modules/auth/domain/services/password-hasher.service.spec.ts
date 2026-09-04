import test from "node:test";
import assert from "node:assert/strict";
import { PasswordHasher } from "./password-hasher.service.js";

test("PasswordHasher stores salted hashes and verifies passwords", async () => {
  const hasher = new PasswordHasher();
  const first = await hasher.hash("secret");
  const second = await hasher.hash("secret");

  assert.notEqual(first, "secret");
  assert.notEqual(first, second);
  assert.equal((await hasher.verify("secret", first)).valid, true);
  assert.equal((await hasher.verify("wrong", first)).valid, false);
});

// M7: Verify unknown algorithm returns invalid, not a crash
test("PasswordHasher rejects unknown algorithm prefix gracefully", async () => {
  const hasher = new PasswordHasher();
  const result = await hasher.verify("password", "argon2id:salt:hash");
  assert.equal(result.valid, false);
  assert.equal(result.shouldRehash, false);
});

// M7: shouldRehash is false for scrypt (current default)
test("PasswordHasher signals shouldRehash=false for current default algorithm", async () => {
  const hasher = new PasswordHasher();
  const hash = await hasher.hash("my-password");
  const result = await hasher.verify("my-password", hash);
  assert.equal(result.valid, true);
  assert.equal(result.shouldRehash, false);
});
