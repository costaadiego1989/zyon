import { Inject, Injectable , Logger} from "@nestjs/common";
import {
  COMMERCE_CONNECTION_PORT,
  type CommerceConnectionPort,
  type MerchantCommerceConnection,
} from "../domain/ports/commerce-connection.port.js";
import {
  COMMERCE_PROVIDER_RUNTIME,
  type CommerceProviderRuntime,
} from "../domain/ports/commerce-provider-runtime.port.js";
import { requiredConnection, commerceGatewayError, errorCode } from "./commerce-connection.helpers.js";
import { CorrelationIdStorage } from "../../../shared/logger/correlation-id.storage.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../../shared/events/domain-event-bus.port.js";
import { Optional } from "@nestjs/common";

@Injectable()
export class SyncCommerceConnectionUseCase {
  private readonly logger = new Logger(SyncCommerceConnectionUseCase.name);

  constructor(
    @Inject(COMMERCE_CONNECTION_PORT)
    private readonly connections: CommerceConnectionPort,
    @Inject(COMMERCE_PROVIDER_RUNTIME)
    private readonly adapters: CommerceProviderRuntime,
    @Optional() @Inject(DOMAIN_EVENT_BUS)
    private readonly eventBus?: DomainEventBus,
  ) {}

  async execute(merchantId: string): Promise<MerchantCommerceConnection> {
    await requiredConnection(this.connections, merchantId);
    try {
      await this.adapters.searchCatalog({ merchantId, limit: 1 });
      await this.connections.updateHealth({
        merchantId,
        status: "healthy",
        syncedAt: new Date().toISOString(),
      });
    } catch (error) {
      const code = errorCode(error);
      await this.connections.updateHealth({
        merchantId,
        status: "degraded",
        errorCode: code,
      });
      // Notify subscribers (tenant webhook bridge) that the connection degraded.
      try {
        await this.eventBus?.publish({
          eventType: "commerce.connection.degraded",
          merchantId,
          payload: { error_code: code, occurred_at: new Date().toISOString() },
        });
      } catch { /* event delivery is best-effort; health is already persisted */ }
      throw commerceGatewayError(error);
    }
    return requiredConnection(this.connections, merchantId);
  }
}
