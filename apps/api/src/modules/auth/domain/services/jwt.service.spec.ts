import test from "node:test";
import assert from "node:assert/strict";
import { JwtService } from "./jwt.service.js";

test("JwtService signs and verifies merchant-scoped principals", () => {
  const jwt = new JwtService("test-secret", 60);
  const token = jwt.sign({
    userId: "usr_1",
    merchantId: "mrc_1",
    email: "owner@example.com",
    role: "owner"
  }, 100);

  assert.deepEqual(jwt.verify(token, 120), {
    userId: "usr_1",
    merchantId: "mrc_1",
    email: "owner@example.com",
    role: "owner"
  });
  assert.throws(() => jwt.verify(token, 161), /jwt_expired/);
});
