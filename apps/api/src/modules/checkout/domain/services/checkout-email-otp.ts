/** Shared comparison/expiration policy for an EXISTING server-owned challenge.
 * No generation, delivery, recognition, persistence or implicit wall clock. */
export function verifyCheckoutEmailOtp(input: {
  code: string; challenge: unknown; expiresAt: unknown; nowMilliseconds: number;
}): "verified" | "expired" | "invalid" {
  const deadline = typeof input.expiresAt === "string" ? Date.parse(input.expiresAt) : NaN;
  if (!Number.isFinite(input.nowMilliseconds) || !Number.isFinite(deadline) || deadline <= input.nowMilliseconds) return "expired";
  return typeof input.challenge === "string" && input.challenge.length > 0 && input.code === input.challenge ? "verified" : "invalid";
}
