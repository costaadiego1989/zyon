import { Inject, Injectable } from "@nestjs/common";
import {
  STOREFRONT_TELEMETRY_PORT,
  type StorefrontTelemetryPort,
} from "../../domain/ports/storefront-telemetry.port.js";

type LiveSessionStage = "data_collection" | "shipping" | "payment" | "completed";

@Injectable()
export class GetStorefrontLiveSessionsUseCase {
  constructor(@Inject(STOREFRONT_TELEMETRY_PORT) private readonly telemetry: StorefrontTelemetryPort) {}

  async execute(merchantId: string) {
    const sessions = await this.telemetry.listLiveSessions(merchantId, new Date(Date.now() - 30 * 60 * 1000));
    return {
      sessions: sessions.map((session) => ({
        sessionId: session.sessionId,
        buyerPhone: "",
        buyerEmail: "",
        buyerName: "",
        stage: resolveLiveSessionStage(session.eventNames),
        lastActivityAt: session.updatedAt.toISOString(),
        abandonmentScore: session.abandonmentScore ?? 0,
      })),
      total: sessions.length,
      status: "active" as const,
    };
  }
}

export function resolveLiveSessionStage(eventNames: string[]): LiveSessionStage {
  if (eventNames.includes("order_completed")) return "completed";
  if (eventNames.includes("payment_method_selected")) return "payment";
  if (eventNames.includes("cart_viewed")) return "shipping";
  return "data_collection";
}
