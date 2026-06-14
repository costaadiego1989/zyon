import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OpenAPIObject } from "@nestjs/swagger";
import { createPublicApiDocument } from "./api-documentation.js";

describe("public OpenAPI document", () => {
  it("prefixes approved operations and excludes internal callbacks by default", () => {
    const document = createPublicApiDocument({
      openapi: "3.0.0",
      info: { title: "test", version: "1" },
      paths: {
        "/auth/login": {
          post: { operationId: "login", responses: {} },
        },
        "/integrations/orders/{externalOrderId}/tracking": {
          put: { operationId: "tracking", responses: {} },
        },
        "/webhooks/stripe": {
          post: { operationId: "stripeCallback", responses: {} },
        },
        "/support/chat": {
          post: { operationId: "legacyPublicChat", responses: {} },
        },
      },
    } as OpenAPIObject);

    assert.deepEqual(Object.keys(document.paths), [
      "/v1/auth/login",
      "/v1/integrations/orders/{externalOrderId}/tracking",
    ]);
    assert.deepEqual(document.paths["/v1/auth/login"]?.post?.security, []);
    assert.deepEqual(
      document.paths["/v1/integrations/orders/{externalOrderId}/tracking"]?.put?.security,
      [{ service_api_key: [] }, { legacy_api_key: [] }],
    );
  });
});
