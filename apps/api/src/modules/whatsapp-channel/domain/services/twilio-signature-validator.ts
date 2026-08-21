/**
 * Twilio Signature Validator — HMAC-SHA1 webhook authentication.
 *
 * Twilio sends x-twilio-signature header with request signature.
 * We must:
 * 1. Sort POST params alphabetically
 * 2. Concatenate: url + key1value1 + key2value2...
 * 3. HMAC-SHA1 with merchant's authToken
 * 4. Base64 encode
 * 5. Compare with constant-time equal
 */

import { createHmac } from "crypto";
import { timingSafeEqual } from "crypto";
import { Logger } from "@nestjs/common";

const logger = new Logger("TwilioSignatureValidator");

/**
 * Validate Twilio request signature.
 *
 * @param signature x-twilio-signature header value (base64)
 * @param requestUrl full webhook URL (e.g., https://example.com/webhooks/twilio)
 * @param params POST body params as object
 * @param authToken merchant's Twilio auth token
 * @returns true if signature is valid
 */
export function validateTwilioSignature(
  signature: string,
  requestUrl: string,
  params: Record<string, string>,
  authToken: string,
): boolean {
  try {
    // 1. Sort params alphabetically by key
    const sortedKeys = Object.keys(params).sort();

    // 2. Concatenate: url + key1value1 + key2value2...
    let data = requestUrl;
    for (const key of sortedKeys) {
      data += key + params[key];
    }

    // 3. HMAC-SHA1 with authToken
    const hmac = createHmac("sha1", authToken);
    hmac.update(data);

    // 4. Base64 encode
    const computed = hmac.digest("base64");

    // 5. Constant-time compare
    try {
      timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
      return true;
    } catch {
      logger.warn("Twilio signature mismatch");
      return false;
    }
  } catch (error) {
    logger.error(`Signature validation error: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
