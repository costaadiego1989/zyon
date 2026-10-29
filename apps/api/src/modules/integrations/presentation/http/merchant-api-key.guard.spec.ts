import { test } from "node:test";
import assert from "node:assert/strict";
import { UnauthorizedException } from "@nestjs/common";
import type { ExecutionContext } from "@nestjs/common";
import { MerchantApiKeyGuard, currentApiKey } from "./merchant-api-key.guard.js";
import { AuthenticateMerchantApiKeyService } from "../../application/authenticate-merchant-api-key.service.js";
import { ApiKeyService } from "../../domain/api-key.service.js";
import { ApiKeyAccessPolicy } from "../../domain/api-key-access-policy.js";
import { InMemoryIntegrationsRepository } from "../../infrastructure/in-memory-integrations.repository.js";

test("MerchantApiKeyGuard extracts key from Authorization Bearer header", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const apiKeys = new ApiKeyService();
  const rawKey = apiKeys.generate("test").rawKey;

  await repo.createApiKey({
    id: "mak_1",
    merchantId: "mrc_1",
    name: "Test",
    keyHash: apiKeys.hash(rawKey),
    keyPrefix: apiKeys.prefix(rawKey),
    scopes: ["orders:read"],
    environment: "test",
    allowedCidrs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const authenticator = new AuthenticateMerchantApiKeyService(repo, apiKeys, new ApiKeyAccessPolicy());
  const guard = new MerchantApiKeyGuard(authenticator);

  const context = mockContext({
    headers: {
      authorization: `Bearer ${rawKey}`,
    },
    ip: "127.0.0.1",
  });

  const result = await guard.canActivate(context);
  assert.equal(result, true);
  assert.ok((context.switchToHttp().getRequest() as any).apiKey);
});

test("MerchantApiKeyGuard extracts key from x-aacp-api-key header", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const apiKeys = new ApiKeyService();
  const rawKey = apiKeys.generate("live").rawKey;

  await repo.createApiKey({
    id: "mak_1",
    merchantId: "mrc_2",
    name: "Live",
    keyHash: apiKeys.hash(rawKey),
    keyPrefix: apiKeys.prefix(rawKey),
    scopes: ["orders:write"],
    environment: "live",
    allowedCidrs: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  });

  const authenticator = new AuthenticateMerchantApiKeyService(repo, apiKeys, new ApiKeyAccessPolicy());
  const guard = new MerchantApiKeyGuard(authenticator);

  const context = mockContext({
    headers: {
      "x-aacp-api-key": rawKey,
    },
    ip: "127.0.0.1",
  });

  const result = await guard.canActivate(context);
  assert.equal(result, true);
});

test("MerchantApiKeyGuard throws 401 if missing API key", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const apiKeys = new ApiKeyService();
  const authenticator = new AuthenticateMerchantApiKeyService(repo, apiKeys, new ApiKeyAccessPolicy());
  const guard = new MerchantApiKeyGuard(authenticator);

  const context = mockContext({
    headers: {},
    ip: "127.0.0.1",
  });

  await assert.rejects(() => guard.canActivate(context), UnauthorizedException);
});

test("MerchantApiKeyGuard throws 401 for invalid API key", async () => {
  const repo = new InMemoryIntegrationsRepository();
  const apiKeys = new ApiKeyService();
  const authenticator = new AuthenticateMerchantApiKeyService(repo, apiKeys, new ApiKeyAccessPolicy());
  const guard = new MerchantApiKeyGuard(authenticator);

  const context = mockContext({
    headers: {
      authorization: "Bearer aacp_test_invalid_key",
    },
    ip: "127.0.0.1",
  });

  await assert.rejects(() => guard.canActivate(context), UnauthorizedException);
});

test("currentApiKey helper extracts API key or throws if missing", async () => {
  const request = {
    apiKey: {
      id: "mak_1",
      merchantId: "mrc_1",
      scopes: ["orders:read"],
      environment: "test",
      allowedCidrs: [],
    },
  };

  const apiKey = currentApiKey(request);
  assert.equal(apiKey.merchantId, "mrc_1");
  assert.equal(apiKey.id, "mak_1");
});

test("currentApiKey throws if apiKey missing from request", () => {
  const request = {};
  assert.throws(() => currentApiKey(request), UnauthorizedException);
});

function mockContext(request: any): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as ExecutionContext;
}
