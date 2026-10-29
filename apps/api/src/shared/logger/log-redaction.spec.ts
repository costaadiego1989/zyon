import { test } from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import { REDACTED_LOG_PATHS, redactRequestUrl } from "./log-redaction.js";

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
