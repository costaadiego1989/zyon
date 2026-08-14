import {
  BadRequestException,
  Inject,
  Injectable,
} from "@nestjs/common";
import {
  COMMERCE_CONNECTION_PORT,
  type CommerceConnectionPort,
  type MerchantCommerceConnection,
  type SaveMerchantCommerceCredentialsInput,
} from "../domain/ports/commerce-connection.port.js";
import {
  COMMERCE_PROVIDER_RUNTIME,
  type CommerceProviderRuntime,
} from "../domain/ports/commerce-provider-runtime.port.js";
import { testAndRecord, requiredConnection } from "./commerce-connection.helpers.js";

@Injectable()
export class ConnectCommerceUseCase {
  constructor(
    @Inject(COMMERCE_CONNECTION_PORT)
    private readonly connections: CommerceConnectionPort,
    @Inject(COMMERCE_PROVIDER_RUNTIME)
    private readonly adapters: CommerceProviderRuntime,
  ) {}

  async execute(
    input: SaveMerchantCommerceCredentialsInput,
  ): Promise<MerchantCommerceConnection> {
    assertSafeConnectionInput(input);
    await this.connections.saveCredentials(input);
    await testAndRecord(
      input.merchantId,
      this.connections,
      this.adapters,
    );
    return requiredConnection(this.connections, input.merchantId);
  }
}

function assertSafeConnectionInput(
  input: SaveMerchantCommerceCredentialsInput,
): void {
  if (input.provider === "magento") {
    let url: URL;
    try { url = new URL(input.baseUrl.trim()); }
    catch { throw new BadRequestException("invalid_magento_base_url"); }
    const hostname = url.hostname.toLowerCase();
    const isLocalDev = process.env.NODE_ENV === "development" &&
      (hostname === "localhost" || hostname === "127.0.0.1");
    if ((!isLocalDev && url.protocol !== "https:") ||
        (!isLocalDev && (hostname === "localhost" || hostname.endsWith(".local"))) ||
        !input.accessToken.trim()) {
      throw new BadRequestException("invalid_magento_connection");
    }
    return;
  }

  if (input.provider === "woocommerce") {
    let url: URL;
    try {
      url = new URL(input.storeUrl.trim());
    } catch {
      throw new BadRequestException("invalid_woocommerce_store_url");
    }
    const hostname = url.hostname.toLowerCase();
    // Dev-mode escape: allow http://localhost:8080 for local testing.
    const isLocalDev = process.env.NODE_ENV === "development" &&
      (hostname === "localhost" || hostname === "127.0.0.1") &&
      url.port === "8080";
    if (
      (!isLocalDev && url.protocol !== "https:") ||
      (!isLocalDev && (hostname === "localhost" ||
        hostname.endsWith(".localhost") ||
        hostname.endsWith(".local") ||
        hostname.includes(":"))) ||
      (!isLocalDev && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) ||
      !input.consumerKey.trim() ||
      !input.consumerSecret.trim()
    ) {
      throw new BadRequestException("invalid_woocommerce_connection");
    }
    return;
  }

  // Other providers pass without validation in this use-case
}
