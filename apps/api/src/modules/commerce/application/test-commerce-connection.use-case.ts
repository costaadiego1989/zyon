import { Inject, Injectable } from "@nestjs/common";
import {
  COMMERCE_CONNECTION_PORT,
  type CommerceConnectionPort,
  type MerchantCommerceConnection,
} from "../domain/ports/commerce-connection.port.js";
import {
  COMMERCE_PROVIDER_RUNTIME,
  type CommerceProviderRuntime,
} from "../domain/ports/commerce-provider-runtime.port.js";
import { testAndRecord, requiredConnection } from "./commerce-connection.helpers.js";

@Injectable()
export class TestCommerceConnectionUseCase {
  constructor(
    @Inject(COMMERCE_CONNECTION_PORT)
    private readonly connections: CommerceConnectionPort,
    @Inject(COMMERCE_PROVIDER_RUNTIME)
    private readonly adapters: CommerceProviderRuntime,
  ) {}

  async execute(merchantId: string): Promise<{
    connection: MerchantCommerceConnection;
    storeName: string;
    currency: string;
  }> {
    const health = await testAndRecord(
      merchantId,
      this.connections,
      this.adapters,
    );
    return {
      connection: await requiredConnection(this.connections, merchantId),
      storeName: health.storeName,
      currency: health.currency,
    };
  }
}
