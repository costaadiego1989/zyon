/** Internal transaction port; deliberately cannot open/commit a transaction. */
type SessionLockTransaction = {
  $queryRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<unknown>;
};

/** Locks the scoped session identity even when its row does not exist yet.
 * Caller owns commit/rollback. Acquire AFTER merchant/config/payment locks and
 * BEFORE checkout row/cart/coupon locks. Never use a root/autocommit client.
 * This is not a cart owner, a payment authorization or a browser capability. */
export async function lockCheckoutSessionAnchor(tx: SessionLockTransaction, merchantId: string, sessionId: string): Promise<void> {
  const key = JSON.stringify(["checkout-session", merchantId, sessionId]);
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
}
