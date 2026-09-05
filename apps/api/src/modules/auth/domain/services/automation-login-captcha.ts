import { createHash, timingSafeEqual } from "node:crypto";

/** Optional, short-lived CAPTCHA exception for an explicitly authorized login audit.
 * Password validation and the normal login rate limiter still run.
 * This is deliberately used only by password login, never registration.
 */
export function isAuthorizedAutomationLogin(
  input: { email: string; turnstile_token?: string },
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): boolean {
  const email = env.AUTH_AUTOMATION_LOGIN_EMAIL?.trim().toLowerCase();
  const secret = env.AUTH_AUTOMATION_LOGIN_TOKEN;
  const expires = Date.parse(env.AUTH_AUTOMATION_LOGIN_EXPIRES_AT ?? "");
  if (!email || !secret || secret.length < 64 || !Number.isFinite(expires)
    || expires <= now || expires > now + 2 * 60 * 60 * 1000
    || input.email?.trim().toLowerCase() !== email
    || typeof input.turnstile_token !== "string" || input.turnstile_token.length > 256) return false;
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(input.turnstile_token), digest(secret));
}
