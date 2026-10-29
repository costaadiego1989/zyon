import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { storefrontWriteScopeSchema } from "../../domain/contracts/storefront-local-cart-write.schemas.js";
import {
  snapshotStorefrontWriteAdmissionRequest, snapshotStorefrontWriteMarkUnknownRequest,
  storefrontWriteAdmissionResultSchema, storefrontWriteMarkUnknownResultSchema,
} from "../../domain/contracts/storefront-write-admission.schemas.js";
import type {
  StorefrontWriteAdmissionPort, StorefrontWriteAdmissionRequest, StorefrontWriteAdmissionResult,
  StorefrontWriteMarkUnknownRequest, StorefrontWriteMarkUnknownResult,
} from "../../domain/ports/storefront-write-admission.port.js";

const revision = z.bigint().min(0n).max(BigInt(Number.MAX_SAFE_INTEGER));
const scopeRowSchema = storefrontWriteScopeSchema.extend({ protocolOwned: z.boolean(), revision });
const requestRowSchema = storefrontWriteScopeSchema.extend({
  requestId: z.uuid(), messageId: z.string().min(1).max(191), protocolVersion: z.number().int().min(1).max(32767),
  fingerprintVersion: z.number().int().min(1).max(32767),
  requestFingerprint: z.instanceof(Uint8Array).refine(bytes => bytes.byteLength >= 16 && bytes.byteLength <= 128),
  commandKind: z.string().min(1).max(191), expectedRevision: revision, claimGeneration: z.literal(1n),
  state: z.enum(["processing", "unknown"]),
});
const claimRowSchema = z.strictObject({ requestId: z.uuid(), claimToken: z.uuid(), claimGeneration: z.literal(1n) });
const single = <T extends z.ZodType>(schema: T, rows: unknown) => z.array(schema).max(1).parse(rows)[0];
const sameScope = (left: z.infer<typeof storefrontWriteScopeSchema>, right: z.infer<typeof storefrontWriteScopeSchema>) =>
  left.merchantId === right.merchantId && left.conversationId === right.conversationId
  && left.cartId === right.cartId && left.principalId === right.principalId;

/** Isolated candidate; deliberately not wired into any production module.
 * The future trusted caller must derive opaque fingerprint bytes from the exact
 * canonical scope/intent snapshot. Byte validation is not a hash/binding policy.
 * This repository stores no raw arguments and never invokes commercial effects. */
export class PrismaStorefrontWriteAdmissionRepository implements StorefrontWriteAdmissionPort {
  constructor(private readonly prisma: PrismaClient) {}

  async admit(input: StorefrontWriteAdmissionRequest): Promise<StorefrontWriteAdmissionResult> {
    const { scope, intent, fingerprint } = snapshotStorefrontWriteAdmissionRequest(input);
    const lockKey = JSON.stringify(["storefront-cart", scope.merchantId, scope.cartId]);
    const result = await this.prisma.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const anchor = single(scopeRowSchema, await tx.$queryRaw`
        SELECT merchant_id AS "merchantId", conversation_id AS "conversationId", cart_id AS "cartId",
          principal_id AS "principalId", protocol_owned AS "protocolOwned", scope_revision AS "revision"
        FROM storefront_execution_scopes
        WHERE merchant_id = ${scope.merchantId} AND conversation_id = ${scope.conversationId}
        FOR UPDATE`);
      if (!anchor || !sameScope(anchor, scope) || !anchor.protocolOwned) return { kind: "scope_unavailable" } as const;

      const existing = single(requestRowSchema, await tx.$queryRaw`
        SELECT id AS "requestId", merchant_id AS "merchantId", conversation_id AS "conversationId", cart_id AS "cartId",
          principal_id AS "principalId", message_id AS "messageId", protocol_version AS "protocolVersion",
          fingerprint_version AS "fingerprintVersion", request_fingerprint AS "requestFingerprint", command_kind AS "commandKind",
          expected_revision AS "expectedRevision", claim_generation AS "claimGeneration", status AS "state"
        FROM storefront_write_requests
        WHERE merchant_id = ${scope.merchantId} AND conversation_id = ${scope.conversationId} AND message_id = ${intent.message_id}
        FOR UPDATE`);
      if (existing) {
        const equal = sameScope(existing, scope) && existing.messageId === intent.message_id
          && existing.protocolVersion === intent.version && Number(existing.expectedRevision) === intent.expected_revision
          && existing.commandKind === intent.command.tool && existing.fingerprintVersion === fingerprint.version
          && existing.requestFingerprint.byteLength === fingerprint.bytes.byteLength
          && existing.requestFingerprint.every((byte, index) => byte === fingerprint.bytes[index]);
        return equal ? { kind: "receipt_required", requestId: existing.requestId, state: existing.state } as const
          : { kind: "identity_conflict" } as const;
      }

      const active = single(requestRowSchema, await tx.$queryRaw`
        SELECT id AS "requestId", merchant_id AS "merchantId", conversation_id AS "conversationId", cart_id AS "cartId",
          principal_id AS "principalId", message_id AS "messageId", protocol_version AS "protocolVersion",
          fingerprint_version AS "fingerprintVersion", request_fingerprint AS "requestFingerprint", command_kind AS "commandKind",
          expected_revision AS "expectedRevision", claim_generation AS "claimGeneration", status AS "state"
        FROM storefront_write_requests
        WHERE merchant_id = ${scope.merchantId} AND conversation_id = ${scope.conversationId} AND status IN ('processing', 'unknown')
        FOR UPDATE`);
      if (active) {
        if (!sameScope(active, scope)) throw new Error("storefront_write_admission_invalid_active_scope");
        return { kind: "lane_blocked" } as const;
      }
      if (Number(anchor.revision) !== intent.expected_revision) return { kind: "revision_conflict" } as const;

      const inserted = single(claimRowSchema, await tx.$queryRaw`
        INSERT INTO storefront_write_requests (merchant_id, conversation_id, cart_id, principal_id, message_id,
          protocol_version, fingerprint_version, request_fingerprint, command_kind, expected_revision)
        VALUES (${scope.merchantId}, ${scope.conversationId}, ${scope.cartId}, ${scope.principalId}, ${intent.message_id},
          ${intent.version}, ${fingerprint.version}, ${Buffer.from(fingerprint.bytes)}, ${intent.command.tool}, ${BigInt(intent.expected_revision)})
        RETURNING id AS "requestId", claim_token AS "claimToken", claim_generation AS "claimGeneration"`);
      if (!inserted) throw new Error("storefront_write_admission_missing_insert_result");
      return { kind: "claimed", claim: { requestId: inserted.requestId, claimToken: inserted.claimToken, claimGeneration: 1 } } as const;
    }, { isolationLevel: "ReadCommitted", maxWait: 10_000, timeout: 15_000 });
    // $transaction must resolve successfully, including COMMIT, before a claim
    // becomes observable. No retry is safe for an uncertain acknowledgement.
    return storefrontWriteAdmissionResultSchema.parse(result);
  }

  async markUnknown(input: StorefrontWriteMarkUnknownRequest): Promise<StorefrontWriteMarkUnknownResult> {
    const { scope, claim } = snapshotStorefrontWriteMarkUnknownRequest(input);
    const count = await this.prisma.$executeRaw`
      UPDATE storefront_write_requests SET status = 'unknown', finished_at = clock_timestamp()
      WHERE merchant_id = ${scope.merchantId} AND conversation_id = ${scope.conversationId}
        AND cart_id = ${scope.cartId} AND principal_id = ${scope.principalId}
        AND id = ${claim.requestId}::uuid AND claim_token = ${claim.claimToken}::uuid
        AND claim_generation = ${BigInt(claim.claimGeneration)} AND status = 'processing'`;
    z.union([z.literal(0), z.literal(1)]).parse(count);
    return storefrontWriteMarkUnknownResultSchema.parse({ kind: count === 1 ? "marked_unknown" : "not_current" });
  }
}

