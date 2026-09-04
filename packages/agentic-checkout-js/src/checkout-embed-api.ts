import type {
  ApplyOfferRequest,
  ApplyOfferResponse,
  ChatMessageRequest,
  ChatMessageResponse,
  StartCheckoutRequest,
  StartCheckoutResponse,
  TrackEventRequest,
  TrackEventResponse
} from "@zyon/shared-types";
import { normalizeEmbedOrigin } from "./embed-client.js";

export type AgenticCheckoutEmbedClientOptions = {
  apiBaseUrl: string;
  embedSessionToken: string;
  fetchImpl?: typeof fetch;
};

export type EmbedCreatePaymentIntentBody = {
  session_id: string;
  idempotency_key: string;
  method?: "pix" | "card" | "boleto";
  accepted_offer_id?: string;
};

export class AgenticCheckoutHttpError extends Error {
  readonly name = "AgenticCheckoutHttpError";

  constructor(
    readonly status: number,
    readonly responseBody: string
  ) {
    super(`agentic_checkout_http_${status}`);
  }
}

export class AgenticCheckoutEmbedClient {
  private readonly base: string;

  private readonly token: string;

  private readonly fetchImpl: typeof fetch;

  constructor(opts: AgenticCheckoutEmbedClientOptions) {
    this.base = normalizeEmbedOrigin(opts.apiBaseUrl);
    this.token = opts.embedSessionToken;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    if (!this.fetchImpl) {
      throw new Error("agentic_checkout_fetch_unavailable_pass_fetchImpl_or_use_node_18_plus");
    }
  }

  private async postJson<TResponse>(path: string, body: unknown): Promise<TResponse> {
    const res = await this.fetchImpl(`${this.base}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AACP-Embed-Token": this.token
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      throw new AgenticCheckoutHttpError(res.status, await res.text());
    }
    return (await res.json()) as TResponse;
  }

  startCheckout(body: Omit<StartCheckoutRequest, "merchant_id">): Promise<StartCheckoutResponse> {
    return this.postJson("/embed/start", body);
  }

  trackEvent(body: Omit<TrackEventRequest, "merchant_id">): Promise<TrackEventResponse> {
    return this.postJson("/embed/track", body);
  }

  sendChat(body: Omit<ChatMessageRequest, "merchant_id">): Promise<ChatMessageResponse> {
    return this.postJson("/embed/chat", body);
  }

  applyOffer(body: Omit<ApplyOfferRequest, "merchant_id">): Promise<ApplyOfferResponse> {
    return this.postJson("/embed/offers/apply", body);
  }

  createPaymentIntent(body: EmbedCreatePaymentIntentBody): Promise<Record<string, unknown>> {
    return this.postJson("/embed/payment/intents", body);
  }
}
