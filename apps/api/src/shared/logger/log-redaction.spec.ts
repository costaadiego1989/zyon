import { test } from "node:test";
import assert from "node:assert/strict";
import pino from "pino";
import { REDACTED_LOG_PATHS } from "./log-redaction.js";

test("HTTP logging redacts webhook credentials, reset tokens and OTP while preserving diagnostic status", () => {
  let output = "";
  const logger = pino({ redact: { paths: REDACTED_LOG_PATHS, censor: "[redacted]" } }, { write(chunk: string) { output += chunk; } });
  const secret = "private-fixture-never-log-this";
  logger.info({ req: { headers: { authorization: secret, cookie: secret, "x-webhook-secret": secret, "x-twilio-signature": secret, "x-internal-service-token": secret },
    body: { code: secret, otp: secret, token: secret, webhookSecret: secret, password: secret } }, res: { statusCode: 503 } }, "delivery_failed");
  assert.ok(!output.includes(secret));
  const event = JSON.parse(output);
  assert.equal(event.res.statusCode, 503);
  assert.equal(event.msg, "delivery_failed");
  assert.equal(event.req.headers["x-webhook-secret"], "[redacted]");
  assert.equal(event.req.body.code, "[redacted]");
});
