import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { storefrontWriteScopeSchema } from "../../domain/contracts/storefront-local-cart-write.schemas.js";
import {
  snapshotStorefrontWriteStateRequest, storefrontWriteStateResultSchema,
  type StorefrontWriteStateRequest, type StorefrontWriteStateResult,
} from "../../domain/contracts/storefront-write-state.schemas.js";
import type { StorefrontWriteStatePort } from "../../domain/ports/storefront-write-state.port.js";

const id = storefrontWriteScopeSchema.shape.cartId;
const revision = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const effect = storefrontWriteScopeSchema.extend({
  requestId: z.uuid(), effectId: z.uuid(), claimGeneration: z.literal(1),
  beforeRevision: revision, afterRevision: revision.min(1),
});
const request = storefrontWriteScopeSchema.extend({
  requestId: z.uuid(), messageId: id, protocolVersion: z.number().int().min(1).max(32767),
  commandKind: z.literal("add_item_to_cart"), expectedRevision: revision,
  claimGeneration: z.literal(1), state: z.enum(["processing", "unknown"]), effect: effect.nullable(),
});
const row = storefrontWriteScopeSchema.extend({
  protocolOwned: z.boolean(), revision: z.bigint().min(0n).max(BigInt(Number.MAX_SAFE_INTEGER)),
  request: request.nullable(),
});
type Scope = z.infer<typeof storefrontWriteScopeSchema>;
const sameScope = (left: Scope, right: Scope) => left.merchantId === right.merchantId
  && left.conversationId === right.conversationId && left.cartId === right.cartId && left.principalId === right.principalId;

/** Internal observation only. Inject the trusted ROOT client, never an ongoing
 * writer transaction (which could expose uncommitted evidence). Single SELECT
 * gives one MVCC statement snapshot: no locks, TTL, business reads, defaults,
 * transaction lifecycle, retries or terminal decision. Parse is not auth.
 * Missing proof is NOT proof of zero effect or permission to re-execute. */
export class PrismaStorefrontWriteStateQuery implements StorefrontWriteStatePort {
  constructor(private readonly prisma: PrismaClient) {}

  async read(input: StorefrontWriteStateRequest): Promise<StorefrontWriteStateResult> {
    const { scope } = snapshotStorefrontWriteStateRequest(input);
    const rows = z.array(row).max(1).parse(await this.prisma.$queryRaw`
      SELECT s.merchant_id AS "merchantId", s.conversation_id AS "conversationId",
        s.cart_id AS "cartId", s.principal_id AS "principalId",
        s.protocol_owned AS "protocolOwned", s.scope_revision AS "revision",
        CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object(
          'merchantId', r.merchant_id, 'conversationId', r.conversation_id,
          'cartId', r.cart_id, 'principalId', r.principal_id, 'requestId', r.id::text,
          'messageId', r.message_id, 'protocolVersion', r.protocol_version,
          'commandKind', r.command_kind, 'expectedRevision', r.expected_revision,
          'claimGeneration', r.claim_generation, 'state', r.status,
          'effect', CASE WHEN e.request_id IS NULL THEN NULL ELSE jsonb_build_object(
            'merchantId', e.merchant_id, 'conversationId', e.conversation_id,
            'cartId', e.cart_id, 'principalId', e.principal_id,
            'requestId', e.request_id::text, 'effectId', e.effect_id::text,
            'claimGeneration', e.claim_generation, 'beforeRevision', e.before_revision,
            'afterRevision', e.after_revision) END) END AS "request"
      FROM storefront_execution_scopes s
      LEFT JOIN storefront_write_requests r ON r.merchant_id = s.merchant_id
        AND r.conversation_id = s.conversation_id AND r.cart_id = s.cart_id AND r.principal_id = s.principal_id
        AND r.status IN ('processing', 'unknown')
      LEFT JOIN storefront_local_cart_effects e ON e.request_id = r.id
        AND e.merchant_id = s.merchant_id AND e.conversation_id = s.conversation_id
        AND e.cart_id = s.cart_id AND e.principal_id = s.principal_id
      WHERE s.merchant_id = ${scope.merchantId} AND s.conversation_id = ${scope.conversationId}
        AND s.cart_id = ${scope.cartId} AND s.principal_id = ${scope.principalId}`);
    const anchor = rows[0];
    if (!anchor || !sameScope(anchor, scope) || !anchor.protocolOwned) return { kind: "scope_unavailable" };
    const pending = anchor.request;
    if (pending) {
      if (!sameScope(pending, scope)) throw new Error("storefront_write_state_invalid_request_scope");
      const proof = pending.effect;
      if (proof) {
        if (!sameScope(proof, scope) || proof.requestId !== pending.requestId
          || proof.beforeRevision !== pending.expectedRevision || proof.afterRevision !== proof.beforeRevision + 1
          || BigInt(proof.afterRevision) > anchor.revision) {
          throw new Error("storefront_write_state_invalid_effect");
        }
      } else if (anchor.revision !== BigInt(pending.expectedRevision)) {
        throw new Error("storefront_write_state_incoherent_revision");
      }
    }
    return storefrontWriteStateResultSchema.parse({ kind: "state", revision: Number(anchor.revision),
      request: pending === null ? null : {
        requestId: pending.requestId, messageId: pending.messageId, protocolVersion: pending.protocolVersion,
        expectedRevision: pending.expectedRevision, state: pending.state,
        effect: pending.effect === null ? null : { effectId: pending.effect.effectId, revision: pending.effect.afterRevision },
      },
    });
  }
}

