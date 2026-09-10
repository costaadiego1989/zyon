/**
 * One authoritative buyer service fee for checkout presentation and payment
 * collection. Resolve it in cents first so every consumer rounds identically.
 */
export const DEFAULT_PLATFORM_FEE_CENTS = 99;
export const DEFAULT_PLATFORM_FEE_BRL = DEFAULT_PLATFORM_FEE_CENTS / 100;

export function readPlatformFeeCents(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.PLATFORM_FEE_BRL?.trim();
  if (!raw) return DEFAULT_PLATFORM_FEE_CENTS;

  const major = Number(raw.replace(",", "."));
  const cents = Math.round(major * 100);
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : DEFAULT_PLATFORM_FEE_CENTS;
}

export function readPlatformFeeBrl(env: NodeJS.ProcessEnv = process.env): number {
  return readPlatformFeeCents(env) / 100;
}
