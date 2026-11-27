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


test("PasswordHasher rejects malformed and noncanonical scrypt keys", async t => {
  const hasher = new PasswordHasher();
  const password = "SyntheticCanonicalPassword123!";
  const hash = await hasher.hash(password);
  const [algorithm, salt, key] = hash.split(":");
  assert.equal(Buffer.from(key!, "base64url").length, 64);
  assert.equal(Buffer.from(key!, "base64url").toString("base64url"), key);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const aliasedLastByte = key!.slice(0, -1) + alphabet[alphabet.indexOf(key!.at(-1)!) + 1];
  const cases = [
    ["ignored punctuation decodes to an empty key", "scrypt:synthetic-salt:!"],
    ["one-byte key", `scrypt:synthetic-salt:${Buffer.alloc(1).toString("base64url")}`],
    ["63-byte key", `scrypt:synthetic-salt:${Buffer.alloc(63).toString("base64url")}`],
    ["65-byte key", `scrypt:synthetic-salt:${Buffer.alloc(65).toString("base64url")}`],
    ["padded key", `${hash}=`],
    ["key with ignored punctuation", `${hash}!`],
    ["key with ignored whitespace", `${hash}\n`],
    ["key with nonzero unused bits", `${algorithm}:${salt}:${aliasedLastByte}`],
  ];
  for (const [name, stored] of cases) {
    await t.test(name!, async () => {
      assert.deepEqual(await hasher.verify(password, stored!), { valid: false, shouldRehash: false });
    });
  }
  assert.deepEqual(await hasher.verify(password, hash), { valid: true, shouldRehash: false });
});

test("PasswordHasher preserves historical salts with a canonical 64-byte key", async () => {
  const { scryptSync } = await import("node:crypto");
  const password = "SyntheticHistoricalPassword123!", salt = "historical-salt+/= with spaces";
  const hash = `scrypt:${salt}:${scryptSync(password, salt, 64).toString("base64url")}`;
  assert.deepEqual(await new PasswordHasher().verify(password, hash), { valid: true, shouldRehash: false });
});
