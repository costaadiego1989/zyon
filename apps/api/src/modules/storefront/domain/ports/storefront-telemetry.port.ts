export const STOREFRONT_TELEMETRY_PORT = Symbol("STOREFRONT_TELEMETRY_PORT");
export const WHATSAPP_RECOVERY_ORIGIN_EVENT = "whatsapp_recovery_origin_v1";

export interface StorefrontTelemetryEvent {
  merchantId: string;
  conversationId: string;
  /** The cart is keyed by conversation today, but it remains explicit here so
   * recovery tracking cannot silently drift if that changes. */
  cartId?: string;
  /** Bound from a verified buyer token; never supplied as a trusted browser id. */
  globalUserId?: string;
  event: string;
  metadata?: Record<string, unknown>;
}

export interface StorefrontLiveSession {
  sessionId: string;
  eventNames: string[];
  updatedAt: Date;
  abandonmentScore: number | null;
}

export interface StorefrontTelemetryPort {
  /** The second argument is private verified adapter context, never browser metadata. */
  recordEvent(event: StorefrontTelemetryEvent, verifiedWhatsApp?: { configId: string }): Promise<void>;
  listLiveSessions(merchantId: string, since: Date): Promise<StorefrontLiveSession[]>;
}
