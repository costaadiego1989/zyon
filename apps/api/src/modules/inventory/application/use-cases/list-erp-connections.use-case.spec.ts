import assert from "node:assert/strict";
import test from "node:test";
import { ListErpConnectionsUseCase } from "./list-erp-connections.use-case.js";

test("lists the safe ERP sync error code without returning connection secrets", async () => {
  const useCase = new ListErpConnectionsUseCase({
    list: async () => [{
      id: "connection_1",
      merchantId: "merchant_1",
      provider: "bling",
      status: "connected",
      directionMode: "bidirectional",
      accessTokenCipher: "secret-access-token",
      refreshTokenCipher: "secret-refresh-token",
      tokenExpiresAt: null,
      lastSyncAt: null,
      lastErrorCode: "erp_bling_http_403",
      config: null,
      createdAt: new Date("2026-09-14T00:00:00.000Z"),
      updatedAt: new Date("2026-09-14T00:00:00.000Z"),
    }],
  } as any);

  const [connection] = await useCase.execute("merchant_1");

  assert.equal(connection.lastErrorCode, "erp_bling_http_403");
  assert.equal(JSON.stringify(connection).includes("secret-access-token"), false);
  assert.equal(JSON.stringify(connection).includes("secret-refresh-token"), false);
});
