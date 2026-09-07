import { Inject, Injectable } from "@nestjs/common";
import {
  STOREFRONT_TELEMETRY_PORT,
  type StorefrontTelemetryEvent,
  type StorefrontTelemetryPort,
} from "../../domain/ports/storefront-telemetry.port.js";

@Injectable()
export class TrackStorefrontEventUseCase {
  constructor(@Inject(STOREFRONT_TELEMETRY_PORT) private readonly telemetry: StorefrontTelemetryPort) {}

  async execute(event: StorefrontTelemetryEvent): Promise<void> {
    try {
      await this.telemetry.recordEvent(event);
    } catch {
      // Storefront conversion must not fail because telemetry is unavailable.
    }
  }
}
