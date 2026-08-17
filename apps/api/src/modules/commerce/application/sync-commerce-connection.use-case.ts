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

@Injectable()
export class SyncCommerceConnectionUseCase {
  private readonly logger = new Logger(SyncCommerceConnectionUseCase.name);

  constructor(
    @Inject(COMMERCE_CONNECTION_PORT)
    private readonly connections: CommerceConnectionPort,
    @Inject(COMMERCE_PROVIDER_RUNTIME)
    private readonly adapters: CommerceProviderRuntime,
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
      await this.connections.updateHealth({
        merchantId,
        status: "degraded",
        errorCode: errorCode(error),
      });
      throw commerceGatewayError(error);
    }
    return requiredConnection(this.connections, merchantId);
  }
}
