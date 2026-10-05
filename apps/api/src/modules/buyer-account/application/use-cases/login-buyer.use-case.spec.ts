import test from "node:test";
import assert from "node:assert/strict";
import { LoginBuyerUseCase } from "./login-buyer.use-case.js";
import { BuyerAccount } from "../../domain/entities/buyer-account.entity.js";
import { PasswordHasher } from "../../../auth/domain/services/password-hasher.service.js";

test("buyer password login rejects incorrect passwords before issuing a session", async () => {
  const hasher = new PasswordHasher();
  const passwordHash = await hasher.hash("Local-Valid-Password-2026!");
  const account = new BuyerAccount({ globalUserId: "buyer_auth_test", email: "buyer@example.test", displayName: "Cliente", passwordHash, createdAt: new Date(), updatedAt: new Date() });
  let signed = 0;
  const login = new LoginBuyerUseCase({ findByEmail: async () => account } as any, hasher, {
    sign: () => { signed++; return "test-session"; }, expiresIn: () => 3600,
  } as any);
  await assert.rejects(login.execute({ email: account.email, password: "Wrong-Password-2026!" }), /invalid_credentials/);
  assert.equal(signed, 0);
  const result = await login.execute({ email: " BUYER@example.test ", password: "Local-Valid-Password-2026!" });
  assert.equal(result.globalUserId, account.globalUserId);
  assert.equal(signed, 1);
});
