import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  STOREFRONT_TELEMETRY_PORT,
  type StorefrontTelemetryEvent,
  type StorefrontTelemetryPort,
} from "../../domain/ports/storefront-telemetry.port.js";

@Injectable()
export class TrackStorefrontEventUseCase {
  constructor(@Inject(STOREFRONT_TELEMETRY_PORT) private readonly telemetry: StorefrontTelemetryPort) {}

  async execute(event: StorefrontTelemetryEvent): Promise<void> {
    if (event.event === "purchase_completed" || event.event === "order_completed") {
      throw new BadRequestException("storefront_event_server_only");
    }
    try {
      await this.telemetry.recordEvent(event);
    } catch {
      // Storefront conversion must not fail because telemetry is unavailable.
    }
  }
}
