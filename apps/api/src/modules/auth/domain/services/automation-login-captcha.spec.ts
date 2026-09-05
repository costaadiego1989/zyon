import assert from "node:assert/strict";
import test from "node:test";
import { isAuthorizedAutomationLogin } from "./automation-login-captcha.js";

const now = Date.parse("2026-09-05T20:00:00Z");
const token = "a".repeat(64);
const input = { email: "audit@example.test", turnstile_token: token };
const env = { AUTH_AUTOMATION_LOGIN_EMAIL: input.email, AUTH_AUTOMATION_LOGIN_TOKEN: token, AUTH_AUTOMATION_LOGIN_EXPIRES_AT: new Date(now + 3600000).toISOString() };

test("automation CAPTCHA exception requires account, private key and short expiration", () => {
  assert.equal(isAuthorizedAutomationLogin(input, env, now), true);
  assert.equal(isAuthorizedAutomationLogin(input, {}, now), false);
  assert.equal(isAuthorizedAutomationLogin({ ...input, email: "other@example.test" }, env, now), false);
  assert.equal(isAuthorizedAutomationLogin({ ...input, turnstile_token: "b".repeat(64) }, env, now), false);
  assert.equal(isAuthorizedAutomationLogin({ email: input.email }, env, now), false);
  assert.equal(isAuthorizedAutomationLogin(input, { ...env, AUTH_AUTOMATION_LOGIN_EXPIRES_AT: "invalid" }, now), false);
  assert.equal(isAuthorizedAutomationLogin(input, env, now + 3600000), false);
  assert.equal(isAuthorizedAutomationLogin(input, { ...env, AUTH_AUTOMATION_LOGIN_EXPIRES_AT: new Date(now + 86400000).toISOString() }, now), false);
});
