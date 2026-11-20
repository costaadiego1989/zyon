import { test } from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import { REDACTED_LOG_PATHS, redactRequestUrl } from "./log-redaction.js";
import { redactFiscalLogRequest, redactFiscalLogResponse } from "./log-redaction.js";
import { redactFiscalTelemetryRequest } from "./log-redaction.js";

test("TINY-09 private OAuth raw URL query is hidden by the real Pino serializer", () => {
  const marker = "private-query-state";
  const request = { url: "/v1/merchants/me/fiscal/olist/oauth/configuration?environment=homologation&state=" + marker,
    originalUrl: "/v1/merchants/me/fiscal/olist/oauth/configuration?state=" + marker, query: { state: marker }, headers: { authorization: "private-header" } };
  let output = "";
  const logger = pino({ serializers: { req: redactFiscalLogRequest } }, { write(chunk: string) { output += chunk; } });
  logger.info({ req: request });
  assert.equal(output.includes(marker), false); assert.equal(output.includes("private-header"), false);
  assert.equal(JSON.parse(output).req.url, "/v1/merchants/me/fiscal/olist/oauth/configuration");
  assert.ok(request.url.includes(marker)); assert.equal(request.query.state, marker);
});

test("TINY-09 Express callback query and original URL never expose the notification capability", () => {
  const request = { url: "/v1/webhooks/fiscal/olist/connection/notification?key=private-express-key", originalUrl: "/v1/webhooks/fiscal/olist/connection/notification?key=private-express-key", query: { key: "private-express-key" }, headers: {} };
  assert.equal(JSON.stringify(redactFiscalLogRequest(request)).includes("private-express-key"), false);
  assert.equal(request.query.key, "private-express-key");
});

test("TINY-09 error telemetry removes callback URL secrets and OAuth request data", () => {
  for (const url of ["https://api.example.test/v1/webhooks/fiscal/olist/connection/notification?key=private-key", "https://api.example.test/v1/merchants/me/fiscal/olist/oauth/complete"]) {
    const event = { level: "error", request: { url, query_string: "private-key", data: "private-code", headers: { authorization: "private-auth" }, cookies: { session: "private-session" } } };
    const logged = redactFiscalTelemetryRequest(event);
    assert.equal(JSON.stringify(logged).includes("private-"), false); assert.equal(logged.level, "error");
    assert.equal(logged.request.url, url.split("?")[0]); assert.equal(event.request.data, "private-code");
  }
});

test("TINY-09 Olist notification URLs hide their query secret without changing the live request", () => {
  const request = { url: "/v1/webhooks/fiscal/olist/connection/notification?key=private-olist-url-secret", headers: { authorization: "private-header" }, body: { cpf: "private-cpf" } };
  const logged = redactFiscalLogRequest(request);
  assert.equal(logged.url, "/v1/webhooks/fiscal/olist/connection/notification");
  assert.equal(JSON.stringify(logged).includes("private-"), false);
  assert.ok(request.url.includes("private-olist-url-secret")); assert.equal(request.headers.authorization, "private-header");
});

test("TINY-09 Olist authorization logs hide application secrets, state, code and response URLs", () => {
  const request = { url: "/v1/merchants/me/fiscal/olist/oauth/authorize", headers: { authorization: "private-auth" }, body: { clientSecret: "private-client-secret", state: "private-state", code: "private-code" } };
  assert.equal(JSON.stringify(redactFiscalLogRequest(request)).includes("private-"), false);
  const response = { headers: {}, body: { url: "private-authorize-url", state: "private-state" }, raw: { req: { url: request.url } } };
  const logged = redactFiscalLogResponse(response);
  assert.equal(JSON.stringify(logged).includes("private-"), false);
  assert.equal(response.body.state, "private-state");
});

test("FISCAL-61 ordinary storefront messages redact buyer and visitor authorization without mutating request headers", () => {
  let output = "";
  const logger = pino({ redact: { paths: REDACTED_LOG_PATHS, censor: "[redacted]" } }, { write(chunk: string) { output += chunk; } });
  const headers = { "x-buyer-authorization": "private-buyer-authorization", "x-ai-user-token": "private-visitor-authorization" };
  logger.info({ req: { url: "/v1/storefront/conversations/original/messages", headers: { ...headers } }, res: { statusCode: 201 } });
  for (const secret of Object.values(headers)) assert.equal(output.includes(secret), false);
  const event = JSON.parse(output);
  assert.equal(event.req.headers["x-buyer-authorization"], "[redacted]");
  assert.equal(event.req.headers["x-ai-user-token"], "[redacted]");
  assert.equal(event.res.statusCode, 201);
  assert.equal(headers["x-buyer-authorization"], "private-buyer-authorization");
  assert.equal(headers["x-ai-user-token"], "private-visitor-authorization");
});

test("HTTP logging redacts webhook credentials, reset tokens and OTP while preserving diagnostic status", () => {
  let output = "";
  const logger = pino({ redact: { paths: REDACTED_LOG_PATHS, censor: "[redacted]" } }, { write(chunk: string) { output += chunk; } });
  const secret = "private-fixture-never-log-this";
  logger.info({ req: { headers: { authorization: secret, cookie: secret, "x-webhook-secret": secret, "x-twilio-signature": secret, "x-internal-service-token": secret },
    body: { code: secret, otp: secret, token: secret, buyer_access_token: secret, webhookSecret: secret, password: secret } }, res: { statusCode: 503, headers: { "set-cookie": secret } } }, "delivery_failed");
  assert.ok(!output.includes(secret));
  const event = JSON.parse(output);
  assert.equal(event.res.statusCode, 503);
  assert.equal(event.msg, "delivery_failed");
  assert.equal(event.req.headers["x-webhook-secret"], "[redacted]");
  assert.equal(event.req.body.code, "[redacted]");
  assert.equal(event.req.body.buyer_access_token, "[redacted]");
  assert.equal(event.res.headers["set-cookie"], "[redacted]");
});

test("private evidence capabilities are removed from log copies without changing the routed URL", () => {
  const request = { url: "/v1/support/photos/photo?access_token=secret&other=ok&token=second&buyer_access_token=third", method: "GET" };
  const result = redactRequestUrl(request);
  assert.equal(result.url, "/v1/support/photos/photo?access_token=[redacted]&other=ok&token=[redacted]&buyer_access_token=[redacted]");
  assert.ok(request.url.includes("secret"));
  assert.equal(result.method, "GET");
});
test("FISCAL-61 private fiscal configuration and receipt fields stay redacted in request and error diagnostics", () => {
  let output = "";
  const logger = pino({ redact: { paths: REDACTED_LOG_PATHS, censor: "[redacted]" } }, { write(chunk: string) { output += chunk; } });
  const privateFields = {
    credential: { secret: "private-company-token" }, credentialCipher: "private-cipher",
    setupCipher: "private-setup-cipher", focusWebhook: { authorization: "private-configured-hook" },
    privateReceipt: { authorizationCode: "private-psp-code" }, certificate: "private-A1", password: "private-password",
    fiscalPayload: { destinatario: "private-full-document" }, rawBody: "private-provider-error-body",
  };
  logger.error({ req: { body: privateFields }, err: { code: "fiscal_provider_unavailable", ...privateFields }, ...privateFields, statusCode: 503 }, "fiscal_operation_failed");
  for (const value of ["private-company-token", "private-cipher", "private-setup-cipher", "private-configured-hook", "private-psp-code", "private-A1", "private-password", "private-full-document", "private-provider-error-body"])
    assert.equal(output.includes(value), false);
  const event = JSON.parse(output);
  assert.equal(event.statusCode, 503);
  assert.equal(event.msg, "fiscal_operation_failed");
  assert.equal(event.err.code, "fiscal_provider_unavailable");
});

test("FISCAL-61 callback serializers copy arbitrary headers and never mutate authentication input", () => {
  const headers = { "x-unlisted-provider-auth": "private-auth", "x-correlation-id": "private-auth" };
  const request = { url: "/v1/webhooks/fiscal/focus/original", headers, body: { private: true }, id: 17 };
  const result = redactFiscalLogRequest(request);
  assert.notEqual(result, request); assert.notEqual(result.headers, headers);
  assert.equal(headers["x-unlisted-provider-auth"], "private-auth");
  assert.equal(result.headers["x-unlisted-provider-auth"], "[redacted]");
  assert.equal(result.id, 17);
  const response = { statusCode: 200, headers, raw: { req: request } };
  assert.equal(redactFiscalLogResponse(response).headers["x-correlation-id"], "[redacted]");
  const ordinary = { ...request, url: "/v1/health" };
  assert.equal(redactFiscalLogRequest(ordinary), ordinary);
  for (const url of ["/v1/webhooks/FISCAL/focus/original?retry=1", "/webhooks/FISCAL-DELIVERY/twilio/original", "/v1/webhooks/fiscal?retry=1"]) {
    const variant = { ...request, url };
    assert.equal(redactFiscalLogRequest(variant).headers["x-unlisted-provider-auth"], "[redacted]");
    assert.equal(variant.headers["x-unlisted-provider-auth"], "private-auth");
  }
});
