import {
  BadRequestException,
  BadGatewayException,
  Inject,
  Injectable,
  NotFoundException,
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

@Injectable()
export class GetCommerceConnectionUseCase {
  constructor(
    @Inject(COMMERCE_CONNECTION_PORT)
    private readonly connections: CommerceConnectionPort,
  ) {}

  execute(merchantId: string): Promise<MerchantCommerceConnection | undefined> {
    return this.connections.getConnection(merchantId);
  }
}

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

@Injectable()
export class SyncCommerceConnectionUseCase {
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

@Injectable()
export class DisconnectCommerceUseCase {
  constructor(
    @Inject(COMMERCE_CONNECTION_PORT)
    private readonly connections: CommerceConnectionPort,
  ) {}

  async execute(merchantId: string): Promise<void> {
    await this.connections.disconnect(merchantId);
  }
}

async function testAndRecord(
  merchantId: string,
  connections: CommerceConnectionPort,
  adapters: CommerceProviderRuntime,
) {
  await requiredConnection(connections, merchantId);
  try {
    const health = await adapters.testConnection(merchantId);
    await connections.updateHealth({
      merchantId,
      status: "healthy",
      testedAt: new Date().toISOString(),
    });
    return health;
  } catch (error) {
    console.error("[commerce] testConnection FAILED:", (error as Error).message, (error as Error).stack?.split("\n").slice(0, 3).join(" "));
    await connections.updateHealth({
      merchantId,
      status: "degraded",
      testedAt: new Date().toISOString(),
      errorCode: errorCode(error),
    });
    throw commerceGatewayError(error);
  }
}

async function requiredConnection(
  connections: CommerceConnectionPort,
  merchantId: string,
): Promise<MerchantCommerceConnection> {
  const connection = await connections.getConnection(merchantId);
  if (!connection) {
    throw new NotFoundException("commerce_connection_not_found");
  }
  return connection;
}

/**
 * P3 fix: never reflect raw provider error messages to the client.
 * The slugified message could contain credentials, internal URLs, or other
 * sensitive details. Map to a fixed allow-list of stable codes instead;
 * log the raw message server-side only via `connections.updateHealth`.
 */
function commerceGatewayError(_error: unknown): BadGatewayException {
  return new BadGatewayException({
    code: "commerce_connection_failed",
    detail: "The commerce provider could not be reached or rejected the credentials.",
  });
}

/**
 * Produces a stable internal error code for server-side health records only.
 * This value is NEVER included in API responses — use `commerceGatewayError`
 * for that.
 */
function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "commerce_provider_error";
  const KNOWN_CODES: ReadonlyArray<string> = [
    "invalid_credentials",
    "store_not_found",
    "rate_limited",
    "provider_unavailable",
    "network_error",
  ];
  const slug = error.message
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .slice(0, 120);
  return KNOWN_CODES.find((c) => slug.includes(c)) ?? "commerce_provider_error";
}

function assertSafeConnectionInput(
  input: SaveMerchantCommerceCredentialsInput,
): void {
  if (input.provider === "shopify") {
    const domain = input.shopDomain
      .trim()
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "")
      .toLowerCase();
    if (
      !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain) ||
      !input.adminAccessToken.trim() ||
      !input.storefrontAccessToken?.trim()
    ) {
      throw new BadRequestException("invalid_shopify_connection");
    }
    return;
  }

  if (input.provider === "nuvemshop") {
    if (!input.storeId.trim() || !/^\d+$/.test(input.storeId.trim())) {
      throw new BadRequestException("invalid_nuvemshop_store_id");
    }
    if (!input.accessToken.trim() || input.accessToken.trim().length < 20) {
      throw new BadRequestException("invalid_nuvemshop_access_token");
    }
    return;
  }

  if (input.provider === "tray") {
    let trayUrl: URL;
    try {
      trayUrl = new URL(input.apiAddress.trim());
    } catch {
      throw new BadRequestException("invalid_tray_api_address");
    }
    const trayHost = trayUrl.hostname.toLowerCase();
    if (
      trayUrl.protocol !== "https:" ||
      trayHost === "localhost" ||
      trayHost.endsWith(".localhost") ||
      trayHost.endsWith(".local") ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(trayHost) ||
      !input.accessToken.trim() ||
      !input.refreshToken.trim() ||
      !input.consumerKey.trim() ||
      !input.consumerSecret.trim()
    ) {
      throw new BadRequestException("invalid_tray_connection");
    }
    return;
  }

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
}
