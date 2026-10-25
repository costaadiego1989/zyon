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
        "/commerce/connections": {
          post: { operationId: "connectCommerce", responses: {} },
        },
        "/catalog": {
          get: { operationId: "catalog", responses: {} },
        },
        "/payments/connections/stripe/onboarding-link": {
          post: { operationId: "stripeOnboarding", responses: {} },
        },
        "/billing/subscription": {
          get: { operationId: "billingSubscription", responses: {} },
        },
        "/installations/{installationId}": {
          get: { operationId: "getInstallation", responses: {} },
          put: { operationId: "updateInstallation", responses: {} },
        },
        "/orders": {
          get: { operationId: "listOrders", responses: {} },
          post: { operationId: "createOrder", responses: {} },
        },
        "/orders/{orderId}/tracking": {
          put: { operationId: "updateTracking", responses: {} },
        },
        "/embed/sessions": {
          post: { operationId: "createEmbedSession", responses: {} },
        },
        "/customers": {
          get: { operationId: "listCustomers", responses: {} },
        },
        "/payments": {
          get: { operationId: "listPayments", responses: {} },
        },
        "/audit-events": {
          get: { operationId: "listAuditEvents", responses: {} },
        },
        "/webhook-endpoints/{endpointId}": {
          get: { operationId: "getWebhookEndpoint", responses: {} },
          put: { operationId: "updateWebhookEndpoint", responses: {} },
        },
        "/support/tickets": {
          get: { operationId: "listSupportTickets", responses: {} },
          post: { operationId: "createSupportTicket", responses: {} },
        },
        "/onboarding": {
          get: { operationId: "getOnboarding", responses: {} },
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
      "/v1/commerce/connections",
      "/v1/catalog",
      "/v1/payments/connections/stripe/onboarding-link",
      "/v1/billing/subscription",
      "/v1/installations/{installationId}",
      "/v1/orders",
      "/v1/orders/{orderId}/tracking",
      "/v1/embed/sessions",
      "/v1/customers",
      "/v1/payments",
      "/v1/audit-events",
      "/v1/webhook-endpoints/{endpointId}",
      "/v1/support/tickets",
      "/v1/onboarding",
    ]);
    assert.deepEqual(document.paths["/v1/auth/login"]?.post?.security, []);
    assert.equal(
      document.paths["/v1/integrations/orders/{externalOrderId}/tracking"],
      undefined,
    );
    assert.ok(document.components?.schemas?.ProblemDetails);
    assert.deepEqual(
      document.paths["/v1/commerce/connections"]?.post?.security,
      [
        { console_session: [] },
        { service_api_key: [] },
        { legacy_api_key: [] },
      ],
    );
    assert.equal(
      document.paths["/v1/catalog"]?.get?.security?.length,
      3,
    );
    assert.deepEqual(
      document.paths[
        "/v1/payments/connections/stripe/onboarding-link"
      ]?.post?.security,
      [{ console_session: [] }],
    );
    assert.deepEqual(
      document.paths["/v1/billing/subscription"]?.get?.security,
      [{ console_session: [] }],
    );
    assert.equal(
      document.paths["/v1/installations/{installationId}"]?.put?.parameters
        ?.some(
          (parameter) =>
            "name" in parameter && parameter.name === "If-Match",
        ),
      true,
    );
    assert.equal(
      document.paths["/v1/webhook-endpoints/{endpointId}"]?.put?.parameters
        ?.some(
          (parameter) =>
            "name" in parameter && parameter.name === "If-Match",
        ),
      true,
    );
    assert.equal(
      document.paths["/v1/support/tickets"]?.post?.security?.length,
      3,
    );
    assert.equal(
      document.paths["/v1/orders"]?.post?.parameters?.some(
        (parameter) =>
          "name" in parameter && parameter.name === "Idempotency-Key",
      ),
      true,
    );
    assert.equal(
      document.paths["/v1/orders/{orderId}/tracking"]?.put?.security?.length,
      3,
    );
    assert.equal(
      document.paths["/v1/embed/sessions"]?.post?.parameters?.some(
        (parameter) =>
          "name" in parameter && parameter.name === "Idempotency-Key",
      ),
      true,
    );
    assert.deepEqual(
      document.paths["/v1/onboarding"]?.get?.security,
      [{ console_session: [] }],
    );
  });
});
