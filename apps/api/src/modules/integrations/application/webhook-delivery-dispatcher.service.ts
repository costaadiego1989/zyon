import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { Agent as HttpAgent, request as httpRequest } from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../domain/ports/integrations.repository.port.js";
import { WebhookSignatureService } from "../domain/webhook-signature.service.js";
import type { MerchantWebhookDelivery } from "../domain/integrations.types.js";
import {
  WEBHOOK_TARGET_POLICY,
  type WebhookTargetPolicy,
} from "../domain/ports/webhook-target-policy.port.js";
import {
  WEBHOOK_DISPATCHER_CONFIG,
  type WebhookDispatcherConfig,
} from "../domain/webhook-dispatcher.config.js";

const MAX_ATTEMPTS = 5;

@Injectable()
export class WebhookDeliveryDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WebhookDeliveryDispatcher.name);
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository,
    private readonly signatures: WebhookSignatureService,
    @Optional()
    @Inject(WEBHOOK_TARGET_POLICY)
    private readonly targetPolicy?: WebhookTargetPolicy,
    @Inject(WEBHOOK_DISPATCHER_CONFIG) private readonly config: WebhookDispatcherConfig = {
      dispatchIntervalMs: 10_000,
      enabled: false,
      nodeEnv: ""
    },
  ) {}

  onModuleInit(): void {
    if (!this.config.enabled) {
      this.logger.log("Webhook dispatcher disabled. Set WEBHOOK_DISPATCHER_ENABLED=true to enable it.");
      return;
    }

    this.timer = setInterval(() => void this.dispatchOnce(), this.config.dispatchIntervalMs);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async dispatchDelivery(delivery: MerchantWebhookDelivery): Promise<void> {
    // Use the same claim path as the poller to prevent double-dispatch races.
    await this.process(delivery);
  }

  async dispatchOnce(): Promise<void> {
    let due: MerchantWebhookDelivery[];
    try {
      // Include "sending" to recover deliveries that crashed mid-flight.
      due = await this.repo.listDueWebhookDeliveries(["pending", "sending"], new Date().toISOString(), 25);
    } catch (error) {
      this.logger.error(`Webhook dispatcher failed to list due deliveries: ${errorMessage(error)}`, errorStack(error));
      return;
    }

    // P1 fix: Process with bounded concurrency (5 at a time) instead of sequentially.
    // Prevents one slow endpoint from blocking all other deliveries (5x speedup).
    // Atomic claim mechanism still prevents double-dispatch.
    const CONCURRENCY = 5;
    for (let i = 0; i < due.length; i += CONCURRENCY) {
      const batch = due.slice(i, i + CONCURRENCY);
      await Promise.allSettled(batch.map((d) => this.process(d)));
    }
  }

  private async process(delivery: MerchantWebhookDelivery): Promise<void> {
    // Atomically claim the row: pending → sending.  If another worker (or
    // the inline dispatch from the event handler) already picked it up the
    // claim returns undefined and we skip this delivery — single-flight
    // guarantee.
    const now = new Date().toISOString();
    let claimed: MerchantWebhookDelivery;
    if (delivery.status === "pending") {
      const result = await this.repo.claimWebhookDelivery(delivery.id, now);
      if (!result) return; // another worker claimed it
      claimed = result;
    } else {
      // Already "sending" (recovered from a prior crash) — re-use as-is.
      claimed = delivery;
    }

    const body = JSON.stringify(claimed.envelope);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    // Look up the signing secret from the endpoint at dispatch time to avoid
    // persisting secrets in the delivery table (INT-H3).
    const signingSecret = await this.resolveSigningSecret(claimed);
    const signature = this.signatures.sign({ secret: signingSecret, timestamp, body });
    let endpointUrl = claimed.endpointUrl;
    let pinnedAddresses: string[] | undefined;
    if (this.targetPolicy) {
      try {
        const resolved = await this.targetPolicy.assertAllowed(endpointUrl);
        endpointUrl = resolved.url;
        pinnedAddresses = resolved.pinnedAddresses;
      } catch {
        await this.repo.updateWebhookDelivery({
          ...claimed,
          status: "failed",
          attempts: claimed.attempts + 1,
          error: "webhook_target_blocked",
          nextAttemptAt: undefined,
          updatedAt: new Date().toISOString(),
        });
        return;
      }
    }

    try {
      const headers = {
        "Content-Type": "application/json",
        "User-Agent": "AACP-Webhooks/1.0",
        "X-AACP-Event-Id": claimed.eventId,
        "X-AACP-Event-Type": claimed.eventType,
        "X-AACP-Timestamp": timestamp,
        "X-AACP-Signature": signature,
      };

      // When the target policy pins IPs (SSRF protection), send via node:http(s)
      // with a custom-lookup Agent. The global fetch (undici) does NOT accept a
      // node http.Agent in `dispatcher`, so a pinned fetch silently fails with a
      // network error — every external HTTPS webhook would never deliver.
      let response: { status: number; ok: boolean; body: string };
      if (pinnedAddresses) {
        response = await sendViaNodeHttp(endpointUrl, headers, body, pinnedAddresses, 5000);
      } else {
        const res = await fetch(endpointUrl, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(5000),
        });
        response = { status: res.status, ok: res.ok, body: await res.text().catch(() => "") };
      }

      const responseBody = response.body;
      if (response.ok) {
        const completedAt = new Date().toISOString();
        await this.repo.updateWebhookDelivery({
          ...claimed,
          status: "delivered",
          attempts: claimed.attempts + 1,
          responseStatus: response.status,
          responseBody: responseBody.slice(0, 2000),
          error: undefined,
          nextAttemptAt: undefined,
          deliveredAt: completedAt,
          updatedAt: completedAt
        });
        return;
      }
      // 4xx (except 408 Request Timeout and 429 Too Many Requests) are
      // terminal — the endpoint explicitly rejected the payload.
      const isNonRetryable4xx =
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408 &&
        response.status !== 429;
      if (isNonRetryable4xx) {
        await this.repo.updateWebhookDelivery({
          ...claimed,
          status: "failed",
          attempts: claimed.attempts + 1,
          responseStatus: response.status,
          responseBody: responseBody.slice(0, 2000),
          error: `http_${response.status}_non_retryable`,
          nextAttemptAt: undefined,
          updatedAt: new Date().toISOString(),
        });
        return;
      }
      await this.retryOrFail(claimed, `http_${response.status}`, response.status, responseBody);
    } catch (error) {
      this.logger.warn(`Webhook delivery ${claimed.id} failed: ${String(error)}`);
      await this.retryOrFail(claimed, "network_error");
    }
  }

  /**
   * Resolves the signing secret for a delivery by looking up the endpoint.
   * Falls back to the delivery's own signingSecret for backward compatibility
   * with records created before INT-H3 fix.
   */
  private async resolveSigningSecret(delivery: MerchantWebhookDelivery): Promise<string> {
    const endpoint = await this.repo.getWebhookEndpoint(delivery.merchantId, delivery.endpointId);
    if (endpoint?.signingSecret) return endpoint.signingSecret;
    // Backward compat: old delivery records still carry the secret.
    if (delivery.signingSecret) return delivery.signingSecret;
    throw new Error(`webhook_signing_secret_not_found:${delivery.endpointId}`);
  }

  private async retryOrFail(delivery: MerchantWebhookDelivery, error: string, status?: number, responseBody?: string): Promise<void> {
    const attempts = delivery.attempts + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    const now = new Date();
    const baseDelaySeconds = Math.min(3600, Math.pow(2, attempts) * 30);
    // Add ±20% random jitter to prevent thundering herd on retries.
    const jitter = baseDelaySeconds * (0.8 + Math.random() * 0.4);
    const delaySeconds = Math.round(jitter);
    await this.repo.updateWebhookDelivery({
      ...delivery,
      status: failed ? "failed" : "pending",
      attempts,
      responseStatus: status,
      responseBody: responseBody?.slice(0, 2000),
      error,
      nextAttemptAt: failed ? undefined : new Date(now.getTime() + delaySeconds * 1000).toISOString(),
      updatedAt: now.toISOString()
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

/**
 * Creates an HTTP/HTTPS Agent that locks DNS resolution to pre-validated
 * addresses, preventing SSRF via DNS rebinding (INT-C1).
 */
function createPinnedAgent(pinnedAddresses: string[], protocol: "http:" | "https:" = "https:"): HttpAgent | HttpsAgent {
  const primaryAddress = pinnedAddresses[0];
  if (!primaryAddress) throw new Error("no_pinned_addresses");

  const family = primaryAddress.includes(":") ? 6 : 4;
  const customLookup = (_hostname: string, options: any, callback: any): void => {
    // node:net may call lookup as (host, cb) or (host, opts, cb), and expects an
    // array when opts.all is set. Handle both to avoid "Invalid IP address".
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    if (options && options.all) {
      callback(null, [{ address: primaryAddress, family }]);
      return;
    }
    callback(null, primaryAddress, family);
  };

  if (protocol === "http:") {
    return new HttpAgent({ lookup: customLookup as any });
  }
  return new HttpsAgent({ lookup: customLookup as any });
}

/**
 * Sends a webhook via node:http(s) using a pinned-IP Agent. Used instead of the
 * global fetch when the target policy pins addresses for SSRF protection —
 * undici's `dispatcher` does not accept a node http.Agent, so pinned fetches
 * would silently fail. TLS SNI/cert validation still uses the original hostname
 * (agent only overrides DNS resolution to the pinned IP).
 */
function sendViaNodeHttp(
  endpointUrl: string,
  headers: Record<string, string>,
  body: string,
  pinnedAddresses: string[],
  timeoutMs: number,
): Promise<{ status: number; ok: boolean; body: string }> {
  const url = new URL(endpointUrl);
  const isHttps = url.protocol === "https:";
  const agent = createPinnedAgent(pinnedAddresses, isHttps ? "https:" : "http:");
  const requestFn = isHttps ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = requestFn(
      url,
      {
        method: "POST",
        agent,
        headers: { ...headers, "Content-Length": Buffer.byteLength(body).toString() },
        // Preserve TLS validation against the real hostname despite the pinned IP.
        servername: isHttps ? url.hostname : undefined,
      } as any,
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const status = res.statusCode ?? 0;
          resolve({
            status,
            ok: status >= 200 && status < 300,
            body: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error("webhook_request_timeout")));
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
