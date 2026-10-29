import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { OpenAPIObject } from "@nestjs/swagger";
import { createPostmanCollection } from "./postman-collection.js";

describe("Postman collection", () => {
  it("derives requests, auth and retry headers from the public OpenAPI document", () => {
    const collection = createPostmanCollection({
      openapi: "3.0.0",
      info: {
        title: "AACP Integration API",
        version: "1.0.0",
        description: "Public API",
      },
      servers: [{ url: "https://sandbox-api.aacp.dev" }],
      paths: {
        "/v1/auth/login": {
          post: {
            tags: ["Identity"],
            summary: "Login",
            security: [],
            responses: {},
          },
        },
        "/v1/orders/{orderId}/tracking": {
          put: {
            tags: ["Orders"],
            summary: "Update tracking",
            parameters: [
              {
                in: "path",
                name: "orderId",
                required: true,
                schema: { type: "string" },
              },
              {
                in: "header",
                name: "Idempotency-Key",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      tracking_code: { type: "string", example: "BR123" },
                    },
                  },
                },
              },
            },
            responses: {},
          },
        },
      },
    } as OpenAPIObject);

    assert.equal(collection.variable[0]?.value, "https://sandbox-api.aacp.dev");
    assert.equal(collection.item[0]?.item[0]?.request.auth?.type, "noauth");
    const tracking = collection.item[1]?.item[0]?.request;
    assert.equal(
      tracking?.url.raw,
      "{{baseUrl}}/v1/orders/:orderId/tracking",
    );
    assert.equal(
      tracking?.header.find((header) => header.key === "Idempotency-Key")
        ?.value,
      "{{$guid}}",
    );
    assert.match(tracking?.body?.raw ?? "", /BR123/);
  });
});
