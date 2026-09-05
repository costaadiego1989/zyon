import { createHash, timingSafeEqual } from "node:crypto";

/** Optional, short-lived CAPTCHA exception for an explicitly authorized audit.
 * Registration and login require separate credentials. Normal account validation still runs.
 */
export function isAuthorizedAutomationLogin(
  input: { email: string; turnstile_token?: string },
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): boolean {
  return isAuthorizedAutomation(input, env, now, "LOGIN");
}

export function isAuthorizedAutomationRegistration(
  input: { email: string; turnstile_token?: string },
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): boolean {
  return isAuthorizedAutomation(input, env, now, "REGISTER");
}

function isAuthorizedAutomation(
  input: { email: string; turnstile_token?: string },
  env: NodeJS.ProcessEnv,
  now: number,
  action: "LOGIN" | "REGISTER",
): boolean {
  const email = env[`AUTH_AUTOMATION_${action}_EMAIL`]?.trim().toLowerCase();
  const secret = env[`AUTH_AUTOMATION_${action}_TOKEN`];
  const expires = Date.parse(env[`AUTH_AUTOMATION_${action}_EXPIRES_AT`] ?? "");
  if (!email || !secret || secret.length < 64 || !Number.isFinite(expires)
    || expires <= now || expires > now + 2 * 60 * 60 * 1000
    || input.email?.trim().toLowerCase() !== email
    || typeof input.turnstile_token !== "string" || input.turnstile_token.length > 256) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(input.turnstile_token), digest(secret));
}
