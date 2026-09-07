export const STOREFRONT_TELEMETRY_PORT = Symbol("STOREFRONT_TELEMETRY_PORT");

export interface StorefrontTelemetryEvent {
  merchantId: string;
  conversationId: string;
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
  recordEvent(event: StorefrontTelemetryEvent): Promise<void>;
  listLiveSessions(merchantId: string, since: Date): Promise<StorefrontLiveSession[]>;
}
