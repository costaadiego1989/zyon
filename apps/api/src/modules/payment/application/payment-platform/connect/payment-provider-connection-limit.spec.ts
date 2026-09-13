import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryPaymentPlatformRepository } from "../../../infrastructure/in-memory-payment-platform.repository.js";
import {
  assertPaymentProviderConnectionCapacity,
  MAX_PAYMENT_PROVIDER_CONNECTIONS,
} from "./payment-provider-connection-limit.js";

async function connect(
  repository: InMemoryPaymentPlatformRepository,
  provider: "stripe" | "asaas" | "mercadopago",
): Promise<void> {
  await repository.saveConnection({
    merchantId: "mrc_limit",
    provider,
    environment: "test",
    status: "pending",
  });
}

test("payment provider capacity allows an existing gateway and rejects a third distinct gateway", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  await connect(repository, "stripe");
  await connect(repository, "asaas");

  await assert.doesNotReject(() =>
    assertPaymentProviderConnectionCapacity(repository, "mrc_limit", "stripe"),
  );
  await assert.rejects(
    () => assertPaymentProviderConnectionCapacity(repository, "mrc_limit", "mercadopago"),
    /payment_provider_connection_limit_reached/,
  );
  await assert.rejects(
    () => connect(repository, "mercadopago"),
    /payment_provider_connection_limit_reached/,
  );
  assert.equal((await repository.listConnections("mrc_limit")).length, MAX_PAYMENT_PROVIDER_CONNECTIONS);
});
