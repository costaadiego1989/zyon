import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthenticateMerchantApiKeyService } from "../../application/authenticate-merchant-api-key.service.js";
import { ApiKeyAccessPolicy } from "../../domain/api-key-access-policy.js";
import { ApiKeyService } from "../../domain/api-key.service.js";
import { InMemoryIntegrationsRepository } from "../../infrastructure/in-memory-integrations.repository.js";
import { RequireApiKeyScopes } from "./api-key-scope.decorator.js";
import { ApiKeyScopeGuard } from "./api-key-scope.guard.js";

describe("service API key authorization", () => {
  it("authenticates an environment-bound key from an allowed CIDR", async () => {
    const repository = new InMemoryIntegrationsRepository();
    const apiKeys = new ApiKeyService();
    const rawKey = apiKeys.generate("live").rawKey;
    await repository.createApiKey({
      id: "mak_live",
      merchantId: "mrc_1",
      name: "ERP",
      keyHash: apiKeys.hash(rawKey),
      keyPrefix: apiKeys.prefix(rawKey),
      scopes: ["orders:read"],
      environment: "live",
      allowedCidrs: ["203.0.113.0/24"],
      createdAt: "2026-06-14T00:00:00.000Z",
    });

    const principal = await new AuthenticateMerchantApiKeyService(
      repository,
      apiKeys,
      new ApiKeyAccessPolicy(),
    ).execute(rawKey, "203.0.113.42");

    assert.equal(principal.merchantId, "mrc_1");
    assert.equal(principal.environment, "live");
  });

  it("rejects expired keys and environment mismatches", async () => {
    const repository = new InMemoryIntegrationsRepository();
    const apiKeys = new ApiKeyService();
    const expiredRawKey = apiKeys.generate("test").rawKey;
    await repository.createApiKey({
      id: "mak_expired",
      merchantId: "mrc_1",
      name: "Expired",
      keyHash: apiKeys.hash(expiredRawKey),
      keyPrefix: apiKeys.prefix(expiredRawKey),
      scopes: ["orders:read"],
      environment: "test",
      allowedCidrs: [],
      createdAt: "2025-01-01T00:00:00.000Z",
      expiresAt: "2025-02-01T00:00:00.000Z",
    });

    const authenticator = new AuthenticateMerchantApiKeyService(
      repository,
      apiKeys,
      new ApiKeyAccessPolicy(),
    );
    await assert.rejects(
      () => authenticator.execute(expiredRawKey),
      UnauthorizedException,
    );

    const mismatchedRawKey = apiKeys.generate("live").rawKey;
    await repository.createApiKey({
      id: "mak_mismatch",
      merchantId: "mrc_1",
      name: "Mismatched",
      keyHash: apiKeys.hash(mismatchedRawKey),
      keyPrefix: apiKeys.prefix(mismatchedRawKey),
      scopes: ["orders:read"],
      environment: "test",
      allowedCidrs: [],
      createdAt: "2026-06-14T00:00:00.000Z",
    });
    await assert.rejects(
      () => authenticator.execute(mismatchedRawKey),
      UnauthorizedException,
    );
  });

  it("honors declarative scopes and the legacy tracking alias", () => {
    class TrackingController {
      update() {}
    }
    const descriptor = Object.getOwnPropertyDescriptor(
      TrackingController.prototype,
      "update",
    );
    RequireApiKeyScopes("tracking:write")(
      TrackingController.prototype,
      "update",
      descriptor!,
    );

    const guard = new ApiKeyScopeGuard(new Reflector());
    assert.equal(
      guard.canActivate(
        contextFor(TrackingController, descriptor!.value, ["orders:tracking:write"]),
      ),
      true,
    );
    assert.throws(
      () => guard.canActivate(contextFor(TrackingController, descriptor!.value, ["orders:read"])),
      ForbiddenException,
    );
  });
});

function contextFor(
  controller: Function,
  handler: Function,
  scopes: string[],
) {
  return {
    getClass: () => controller,
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({
        apiKey: {
          id: "mak_1",
          merchantId: "mrc_1",
          scopes,
          environment: "test",
          allowedCidrs: [],
        },
      }),
    }),
  } as never;
}
