import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { GRAPH_READ_TEMPLATES } from "../domain/graph-query.js";
import { graphReadSchema } from "../domain/graph-query.js";
import { z } from "zod";
import { PUBLIC_BUSINESS_TEMPLATE_HASH, publicBusinessReadSchema } from "../domain/public-business-query.js";
export const GRAPH_QUERY_PROTOCOL = 1;
export const GRAPH_TEMPLATE_HASH = createHash("sha256").update(JSON.stringify(GRAPH_READ_TEMPLATES)).digest("hex");
// One pinned previous release, for rolling API/gateway updates. Its catalog
// predicates equal the new template with empty OR groups. No arbitrary hash.
export const GRAPH_PREVIOUS_TEMPLATE_HASH = "aedbee100f49e9f32f7f0ba43c66a6c4e9a1d27e9b5f0fce89029f0b550f8a9b";
export const gatewayTemplateHash = z.enum([GRAPH_TEMPLATE_HASH, GRAPH_PREVIOUS_TEMPLATE_HASH]);
export const GRAPH_GATEWAY_MAX_BODY_BYTES = 128 * 1024;
export const gatewayReadEnvelope = z.strictObject({ protocol: z.literal(GRAPH_QUERY_PROTOCOL),
  templateHash: gatewayTemplateHash, input: graphReadSchema }).refine(value => value.templateHash !== GRAPH_PREVIOUS_TEMPLATE_HASH
    || value.input.kind !== "merchant_help" && value.input.attributeAnyOf.length === 0, "previous_template_cannot_use_new_capabilities");
export const publicBusinessReadEnvelope = z.strictObject({ protocol: z.literal(GRAPH_QUERY_PROTOCOL),
  templateHash: z.literal(PUBLIC_BUSINESS_TEMPLATE_HASH), input: publicBusinessReadSchema });
const digest = (body: string) => createHash("sha256").update(body).digest("hex");
const signature = (key: string, value: string) => createHmac("sha256", key).update(value).digest("hex");
function equalSignature(actual: unknown, expected: string) {
  return typeof actual === "string" && /^[a-f0-9]{64}$/.test(actual)
    && timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}
export interface QueryAuthHeaders { keyId: string; timestamp: string; nonce: string; signature: string }
export function signQuery(key: string, keyId: string, path: string, body: string, now = Date.now(), nonce = randomBytes(24).toString("hex")): QueryAuthHeaders {
  const timestamp = String(now);
  return { keyId, timestamp, nonce, signature: signature(key, `request\nPOST\n${path}\n${timestamp}\n${nonce}\n${digest(body)}`) };
}
export function verifyQuery(key: string, headers: QueryAuthHeaders, path: string, body: string, now = Date.now()): boolean {
  const time = Number(headers.timestamp);
  return Number.isSafeInteger(time) && /^\d{13}$/.test(headers.timestamp) && Math.abs(now - time) <= 30_000
    && /^[a-f0-9]{48}$/.test(headers.nonce)
    && equalSignature(headers.signature, signature(key, `request\nPOST\n${path}\n${headers.timestamp}\n${headers.nonce}\n${digest(body)}`));
}
export const signQueryResponse = (key: string, nonce: string, status: number, body: string) =>
  signature(key, `response\n${nonce}\n${status}\n${digest(body)}`);
export const verifyQueryResponse = (key: string, nonce: string, status: number, body: string, signed: unknown) =>
  equalSignature(signed, signQueryResponse(key, nonce, status, body));
