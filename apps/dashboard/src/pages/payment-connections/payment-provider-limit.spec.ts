import { describe, expect, it } from "vitest";
import type { PaymentConnection } from "../../api-client.js";
import {
  gatewayConnectionCount,
  MAX_PAYMENT_GATEWAY_CONNECTIONS,
  providerConnectionLimitReached,
} from "./payment-provider-limit.js";

const connections: PaymentConnection[] = [
  { id: "stripe_1", provider: "stripe", status: "active", account_id: null, created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" },
  { id: "asaas_1", provider: "asaas", status: "pending", account_id: null, created_at: "2026-09-01T00:00:00.000Z", updated_at: "2026-09-01T00:00:00.000Z" },
];

describe("payment provider connection limit", () => {
  it("keeps an existing provider operable and blocks only a third gateway", () => {
    expect(gatewayConnectionCount(connections)).toBe(MAX_PAYMENT_GATEWAY_CONNECTIONS);
    expect(providerConnectionLimitReached(connections, "stripe")).toBe(false);
    expect(providerConnectionLimitReached(connections, "asaas")).toBe(false);
    expect(providerConnectionLimitReached(connections, "mercadopago")).toBe(true);
  });
});
