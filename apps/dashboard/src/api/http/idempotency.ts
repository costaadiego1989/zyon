/**
 * Idempotency key generation and management.
 * Used to ensure POST/PATCH/PUT/DELETE requests are safely retryable.
 */

export function createIdempotencyKey(): string {
  const random =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `dashboard_${random}`;
}

/**
 * Create a stable (deterministic) idempotency key for a named action.
 * Useful when you want retries to use the same key.
 */
export function stableIdempotencyKey(actionId: string): string {
  return `dashboard_action_${actionId}`;
}
