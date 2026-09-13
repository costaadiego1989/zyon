import type { PaymentConnection } from "../../api-client.js";

export const MAX_PAYMENT_GATEWAY_CONNECTIONS = 2;

const GATEWAY_PROVIDERS = new Set(["stripe", "asaas", "mercadopago"]);

export function gatewayConnectionCount(connections: PaymentConnection[]): number {
  return connections.filter((connection) => GATEWAY_PROVIDERS.has(connection.provider)).length;
}

export function providerConnectionLimitReached(
  connections: PaymentConnection[],
  provider: "stripe" | "asaas" | "mercadopago",
): boolean {
  if (connections.some((connection) => connection.provider === provider)) return false;
  return gatewayConnectionCount(connections) >= MAX_PAYMENT_GATEWAY_CONNECTIONS;
}
