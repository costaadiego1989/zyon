import { Injectable, Logger } from "@nestjs/common";
import { HttpClientService } from "../../../shared/http/http-client.service.js";
import {
  COMMERCE_CONNECTION_PORT,
  type CommerceConnectionPort,
  type NuvemshopCommerceCredentials,
} from "../domain/ports/commerce-connection.port.js";
import { Inject } from "@nestjs/common";

export const NUVEMSHOP_WEBHOOK_EVENTS = [
  "order/created",
  "order/updated",
  "order/paid",
  "order/cancelled",
  "product/created",
  "product/updated",
  "product/deleted",
] as const;

export type NuvemshopWebhookEvent = (typeof NUVEMSHOP_WEBHOOK_EVENTS)[number];

export type RegisterNuvemshopWebhooksInput = {
  merchantId: string;
  /**
   * Absolute URL that Nuvemshop will POST to. Must be HTTPS and resolve
   * to the AACP receiver at `/webhooks/nuvemshop/:merchantId`.
   */
  callbackUrl: string;
};

export type RegisterNuvemshopWebhooksOutput = {
  registered: number;
  skipped: number;
};

/**
 * Registers the canonical set of AACP inbound webhooks for a Nuvemshop
 * merchant. Nuvemshop webhooks are server-side created via:
 *   POST https://api.tiendanube.com/2025-03/{store_id}/webhooks
 *
 * Best-effort: a failed registration does not fail connect flow because
 * Nuvemshop permits late registration and merchants can re-register on
 * reconnect. Callers should treat failures as advisory.
 *
 * Spec: https://tiendanube.github.io/api-documentation/resources/webhook
 */
@Injectable()
export class RegisterNuvemshopWebhooksUseCase {
  private readonly logger = new Logger(RegisterNuvemshopWebhooksUseCase.name);

  constructor(
    @Inject(COMMERCE_CONNECTION_PORT)
    private readonly connections: CommerceConnectionPort,
    private readonly http: HttpClientService,
  ) {}

  async execute(
    input: RegisterNuvemshopWebhooksInput,
  ): Promise<RegisterNuvemshopWebhooksOutput> {
    const merchantId = input.merchantId.trim();
    const callbackUrl = input.callbackUrl.trim();
    if (!merchantId) {
      return { registered: 0, skipped: 0 };
    }
    if (!/^https:\/\//i.test(callbackUrl)) {
      this.logger.warn(
        `nuvemshop_webhook_callback_url_invalid merchant=${merchantId}`,
      );
      return { registered: 0, skipped: NUVEMSHOP_WEBHOOK_EVENTS.length };
    }

    const credentials = await this.connections.getCredentials(merchantId);
    if (!credentials || credentials.provider !== "nuvemshop") {
      return { registered: 0, skipped: NUVEMSHOP_WEBHOOK_EVENTS.length };
    }
    const shop = credentials as NuvemshopCommerceCredentials;

    let registered = 0;
    let skipped = 0;
    for (const event of NUVEMSHOP_WEBHOOK_EVENTS) {
      try {
        await this.registerOne(shop, event, callbackUrl);
        registered += 1;
      } catch (error) {
        skipped += 1;
        this.logger.warn(
          `nuvemshop_webhook_register_failed merchant=${merchantId} event=${event} error=${(error as Error).message}`,
        );
      }
    }

    return { registered, skipped };
  }

  private async registerOne(
    credentials: NuvemshopCommerceCredentials,
    event: NuvemshopWebhookEvent,
    callbackUrl: string,
  ): Promise<void> {
    const url = `https://api.tiendanube.com/2025-03/${encodeURIComponent(credentials.storeId.trim())}/webhooks`;
    const userAgent =
      credentials.userAgent?.trim() || "AACP (https://aacp.example)";
    const response = await this.http.toFetch()(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${credentials.accessToken.trim()}`,
        "User-Agent": userAgent,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ event, url: callbackUrl }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `nuvemshop_webhook_register_failed_${response.status}${detail ? `:${detail.slice(0, 256)}` : ""}`,
      );
    }
  }
}