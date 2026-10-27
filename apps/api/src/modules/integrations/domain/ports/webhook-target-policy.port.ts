export const WEBHOOK_TARGET_POLICY = Symbol("WEBHOOK_TARGET_POLICY");

export interface ResolvedWebhookTarget {
  url: string;
  /** Pre-validated IP addresses to use for this hostname. */
  pinnedAddresses: string[];
}

export interface WebhookTargetPolicy {
  /**
   * Resolves and validates the webhook target URL.
   * Returns both the URL and the pre-resolved IP addresses to prevent SSRF
   * via DNS rebinding (TOCTOU attack).
   */
  assertAllowed(rawUrl: string): Promise<ResolvedWebhookTarget>;
}
