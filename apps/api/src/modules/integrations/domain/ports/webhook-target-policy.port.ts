export const WEBHOOK_TARGET_POLICY = Symbol("WEBHOOK_TARGET_POLICY");

export interface WebhookTargetPolicy {
  assertAllowed(rawUrl: string): Promise<string>;
}
