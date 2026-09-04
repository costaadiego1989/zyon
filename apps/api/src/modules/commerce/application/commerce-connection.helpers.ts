import {
  BadGatewayException,
  NotFoundException,
} from "@nestjs/common";
import type {
  CommerceConnectionPort,
  MerchantCommerceConnection,
} from "../domain/ports/commerce-connection.port.js";
import type { CommerceProviderRuntime } from "../domain/ports/commerce-provider-runtime.port.js";

export async function testAndRecord(
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

export async function requiredConnection(
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
export function commerceGatewayError(_error: unknown): BadGatewayException {
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
export function errorCode(error: unknown): string {
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
