/**
 * Configuration interface for the webhook delivery dispatcher.
 *
 * Holds environment-derived values that were previously read via `process.env`
 * inside the application/service layer. Resolved once at module init and
 * injected via DI — application code never touches `process.env` directly.
 */
export interface WebhookDispatcherConfig {
  /**
   * Polling interval for the dispatcher in milliseconds.
   * Resolved from `WEBHOOK_DISPATCH_INTERVAL_MS`. Defaults to 10_000 when
   * unset or invalid.
   */
  dispatchIntervalMs: number;

  /**
   * Whether the dispatcher is enabled at runtime.
   * Resolved from `WEBHOOK_DISPATCHER_ENABLED` (1/true/yes/on enables,
   * 0/false/no/off disables). Defaults to `true` in production, `false`
   * otherwise.
   */
  enabled: boolean;

  /**
   * Current node environment string, preserved so callers can distinguish
   * production vs non-production without re-reading `process.env`.
   */
  nodeEnv: string;
}

export const WEBHOOK_DISPATCHER_CONFIG = Symbol.for("WebhookDispatcherConfig");

const DEFAULT_DISPATCH_INTERVAL_MS = 10_000;

function resolveDispatchIntervalMs(): number {
  const raw = Number(process.env.WEBHOOK_DISPATCH_INTERVAL_MS);
  if (Number.isFinite(raw) && raw >= 100) return raw;
  return DEFAULT_DISPATCH_INTERVAL_MS;
}

function resolveEnabled(nodeEnv: string): boolean {
  const configured = process.env.WEBHOOK_DISPATCHER_ENABLED?.trim().toLowerCase();
  if (configured && ["1", "true", "yes", "on"].includes(configured)) return true;
  if (configured && ["0", "false", "no", "off"].includes(configured)) return false;
  return nodeEnv === "production";
}

/**
 * Factory used by NestJS module providers to build the dispatcher config
 * from environment variables. Centralizes the `process.env` reads so the
 * application/service layer never sees them.
 */
export function createWebhookDispatcherConfig(): WebhookDispatcherConfig {
  const nodeEnv = process.env.NODE_ENV ?? "";
  return {
    dispatchIntervalMs: resolveDispatchIntervalMs(),
    enabled: resolveEnabled(nodeEnv),
    nodeEnv
  };
}