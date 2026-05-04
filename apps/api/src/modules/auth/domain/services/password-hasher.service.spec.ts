import test from "node:test";
import assert from "node:assert/strict";
import { PasswordHasher } from "./password-hasher.service.js";

test("PasswordHasher stores salted hashes and verifies passwords", async () => {
  const hasher = new PasswordHasher();
  const first = await hasher.hash("secret");
  const second = await hasher.hash("secret");

  assert.notEqual(first, "secret");
  assert.notEqual(first, second);
  assert.equal(await hasher.verify("secret", first), true);
  assert.equal(await hasher.verify("wrong", first), false);
});
