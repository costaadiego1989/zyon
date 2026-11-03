import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { GRAPH_READ_TEMPLATES } from "../domain/graph-query.js";
import { graphReadSchema } from "../domain/graph-query.js";
import { z } from "zod";
export const GRAPH_QUERY_PROTOCOL = 1;
export const GRAPH_TEMPLATE_HASH = createHash("sha256").update(JSON.stringify(GRAPH_READ_TEMPLATES)).digest("hex");
export const GRAPH_GATEWAY_MAX_BODY_BYTES = 128 * 1024;
export const gatewayReadEnvelope = z.strictObject({ protocol: z.literal(GRAPH_QUERY_PROTOCOL),
  templateHash: z.literal(GRAPH_TEMPLATE_HASH), input: graphReadSchema });
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
