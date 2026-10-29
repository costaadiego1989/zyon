import { Injectable, Logger } from "@nestjs/common";

export type Ga4EventName =
  | "conversation_start"
  | "product_view"
  | "add_to_cart"
  | "begin_checkout"
  | "purchase";

export interface Ga4EventParams {
  [key: string]: unknown;
}

export interface Ga4Event {
  name: Ga4EventName;
  params?: Ga4EventParams;
}

const MEASUREMENT_ENDPOINT = "https://www.google-analytics.com/mp/collect";

/**
 * Server-side Google Analytics 4 Measurement Protocol client.
 *
 * Sends events directly from the API to GA4 using Measurement Protocol.
 * No-op when GA4_MEASUREMENT_ID / GA4_API_SECRET env vars are missing.
 *
 * Events are fire-and-forget: failures are logged but never thrown, so
 * analytics outages cannot block commerce flows.
 */
@Injectable()
export class GA4MeasurementService {
  private readonly logger = new Logger(GA4MeasurementService.name);
  private readonly measurementId: string | undefined;
  private readonly apiSecret: string | undefined;

  constructor() {
    this.measurementId = process.env.GA4_MEASUREMENT_ID;
    this.apiSecret = process.env.GA4_API_SECRET;

    if (!this.measurementId || !this.apiSecret) {
      this.logger.debug(
        "GA4 measurement disabled: GA4_MEASUREMENT_ID or GA4_API_SECRET not set",
      );
    }
  }

  /**
   * Send one or more events to GA4. Returns true if dispatched, false if
   * skipped (env vars missing) or failed.
   */
  async send(clientId: string, events: Ga4Event[]): Promise<boolean> {
    if (!this.measurementId || !this.apiSecret) {
      return false;
    }

    if (!clientId || events.length === 0) {
      return false;
    }

    const url = `${MEASUREMENT_ENDPOINT}?measurement_id=${encodeURIComponent(this.measurementId)}&api_secret=${encodeURIComponent(this.apiSecret)}`;

    const body = {
      client_id: clientId,
      events: events.map((e) => ({
        name: e.name,
        params: {
          ...(e.params ?? {}),
          // Always include a timestamp for server-side events
          engagement_time_msec: 1,
        },
      })),
    };

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        this.logger.warn(
          `GA4 measurement rejected: ${res.status} ${res.statusText}`,
        );
        return false;
      }

      // GA4 returns 204 on success. Drain body to free sockets.
      await res.text().catch(() => undefined);
      return true;
    } catch (err) {
      this.logger.warn(
        `GA4 measurement failed: ${(err as Error).message}`,
      );
      return false;
    }
  }

  /** Convenience: send a single event. */
  async sendOne(
    clientId: string,
    name: Ga4EventName,
    params?: Ga4EventParams,
  ): Promise<boolean> {
    return this.send(clientId, [{ name, params }]);
  }
}