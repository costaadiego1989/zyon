import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { StorefrontCart } from "../../domain/ports/storefront-cart.port.js";
import { storefrontWriteScopeSchema } from "../../domain/contracts/storefront-local-cart-write.schemas.js";
import {
  snapshotStorefrontClaimedCartEffectRequest, storefrontClaimedCartEffectResultSchema,
  storefrontResolvedLocalCartItemSchema, storefrontLocalCartRuleOutcomeSchema, storefrontLocalCartCommercialOutcomeV1Schema,
  type StorefrontClaimedCartEffectRequest, type StorefrontClaimedCartEffectResult,
  type StorefrontResolvedLocalCartItem, type StorefrontLocalCartCommercialOutcomeV1,
} from "../../domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { extractOptionGroups } from "../../domain/food-options.js";
import { validateFoodMetadata } from "../../../catalog/domain/services/food-options-validation.js";
import { PrismaStorefrontCartUnitOfWork } from "./prisma-storefront-cart-unit-of-work.js";

type Scope = z.infer<typeof storefrontWriteScopeSchema>;
type Intent = StorefrontClaimedCartEffectRequest["intent"];
export interface StorefrontLocalCartEffectDependencies {
  resolveItem(tx: Prisma.TransactionClient, scope: Readonly<Scope>, intent: Readonly<Intent>): Promise<StorefrontResolvedLocalCartItem>;
  evaluateRules(tx: Prisma.TransactionClient, scope: Readonly<Scope>, cart: StorefrontCart): Promise<StorefrontLocalCartCommercialOutcomeV1>;
}

const id = storefrontWriteScopeSchema.shape.cartId;
const revision = z.bigint().min(0n).max(BigInt(Number.MAX_SAFE_INTEGER));
const scopeRow = storefrontWriteScopeSchema.extend({ protocolOwned: z.boolean(), revision });
const requestRow = storefrontWriteScopeSchema.extend({
  requestId: z.uuid(), messageId: id, protocolVersion: z.number().int().min(1).max(32767),
  fingerprintVersion: z.number().int().min(1).max(32767),
  requestFingerprint: z.instanceof(Uint8Array).refine(value => value.byteLength >= 16 && value.byteLength <= 128),
  commandKind: z.literal("add_item_to_cart"), expectedRevision: revision, claimGeneration: z.literal(1n),
  state: z.enum(["processing", "unknown"]),
});
const effectRow = storefrontWriteScopeSchema.extend({
  effectId: z.uuid(), requestId: z.uuid(), claimGeneration: z.literal(1n), beforeRevision: revision,
  afterRevision: revision, cartRowId: id, cartUpdatedAt: z.date(),
});
const existingCartRow = z.strictObject({ id, items: z.array(z.unknown()), couponCode: z.string().nullable() });
const productProjection = z.strictObject({
  id, type: z.string(), metadata: z.unknown().refine(value => value !== undefined),
});
const catalogRow = z.strictObject({ product: productProjection });
const existingCatalogRow = z.strictObject({ id, product: productProjection });
const existingLine = z.object({ variantId: id, productId: id,
  unitPriceCents: z.number().int().min(0).max(2_147_483_647), quantity: z.number().int().min(1).max(99) }).passthrough();
const single = <T extends z.ZodType>(schema: T, rows: unknown) => z.array(schema).max(1).parse(rows)[0];
const sameScope = (left: Scope, right: Scope) => left.merchantId === right.merchantId
  && left.conversationId === right.conversationId && left.cartId === right.cartId && left.principalId === right.principalId;

function frozenCart(cart: StorefrontCart): StorefrontCart {
  const copy = structuredClone(cart);
  const freeze = (value: unknown): void => {
    if (value !== null && typeof value === "object") {
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    }
  };
  freeze(copy);
  return copy;
}

function assertSupportedCart(value: z.infer<typeof existingCartRow>): void {
  if (value.couponCode !== null) throw new Error("storefront_effect_cart_unsupported");
  for (const item of value.items) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) throw new Error("storefront_effect_cart_invalid");
    const line = item as Record<string, unknown>;
    if (line.marketplace !== undefined || line.selectedServiceSlot !== undefined
      || (line.selectedOptions !== undefined && (!Array.isArray(line.selectedOptions) || line.selectedOptions.length > 0))) {
      throw new Error("storefront_effect_cart_unsupported");
    }
  }
}

function assertSupportedProduct(product: z.infer<typeof productProjection>): void {
  if (product.type !== "physical" || validateFoodMetadata(product.metadata) || extractOptionGroups(product.metadata).length > 0) {
    throw new Error("storefront_effect_product_unsupported");
  }
}

/** Candidate only, not wired into a module or public command. Trusted tx-bound
 * price/rules readers are REQUIRED; synthetic readers do not authorize rollout.
 * A reference records this controlled local transaction, not full pricing proof,
 * completion, reconciliation, generation takeover or all-writer fencing. */
export class PrismaStorefrontLocalCartEffectExecutor {
  private readonly uow: PrismaStorefrontCartUnitOfWork;
  constructor(prisma: PrismaClient) { this.uow = new PrismaStorefrontCartUnitOfWork(prisma); }

  async execute(input: StorefrontClaimedCartEffectRequest, dependencies: StorefrontLocalCartEffectDependencies): Promise<StorefrontClaimedCartEffectResult> {
    const { scope, intent, fingerprint, claim } = snapshotStorefrontClaimedCartEffectRequest(input);
    if (typeof dependencies?.resolveItem !== "function" || typeof dependencies?.evaluateRules !== "function") {
      throw new Error("storefront_effect_dependencies_required");
    }
    const { resolveItem, evaluateRules } = dependencies;
    const result = await this.uow.run({ merchantId: scope.merchantId, cartId: scope.cartId }, async ({ cart, tx }) => {
      const anchor = single(scopeRow, await tx.$queryRaw`
        SELECT merchant_id AS "merchantId", conversation_id AS "conversationId", cart_id AS "cartId",
          principal_id AS "principalId", protocol_owned AS "protocolOwned", scope_revision AS "revision"
        FROM storefront_execution_scopes
        WHERE merchant_id = ${scope.merchantId} AND conversation_id = ${scope.conversationId} FOR UPDATE`);
      if (!anchor || !sameScope(anchor, scope) || !anchor.protocolOwned) return { kind: "scope_unavailable" } as const;

      const request = single(requestRow, await tx.$queryRaw`
        SELECT id AS "requestId", merchant_id AS "merchantId", conversation_id AS "conversationId", cart_id AS "cartId",
          principal_id AS "principalId", message_id AS "messageId", protocol_version AS "protocolVersion",
          fingerprint_version AS "fingerprintVersion", request_fingerprint AS "requestFingerprint", command_kind AS "commandKind",
          expected_revision AS "expectedRevision", claim_generation AS "claimGeneration", status AS "state"
        FROM storefront_write_requests
        WHERE merchant_id = ${scope.merchantId} AND conversation_id = ${scope.conversationId}
          AND cart_id = ${scope.cartId} AND principal_id = ${scope.principalId}
          AND id = ${claim.requestId}::uuid AND claim_token = ${claim.claimToken}::uuid
          AND claim_generation = ${BigInt(claim.claimGeneration)} FOR UPDATE`);
      if (!request || !sameScope(request, scope) || request.requestId !== claim.requestId) return { kind: "not_current" } as const;
      if (request.messageId !== intent.message_id || request.protocolVersion !== intent.version
        || request.expectedRevision !== BigInt(intent.expected_revision) || request.commandKind !== intent.command.tool
        || request.fingerprintVersion !== fingerprint.version || request.requestFingerprint.byteLength !== fingerprint.bytes.byteLength
        || !request.requestFingerprint.every((byte, index) => byte === fingerprint.bytes[index])) return { kind: "identity_conflict" } as const;

      const existing = single(effectRow, await tx.$queryRaw`
        SELECT effect_id AS "effectId", request_id AS "requestId", merchant_id AS "merchantId", conversation_id AS "conversationId",
          cart_id AS "cartId", principal_id AS "principalId", claim_generation AS "claimGeneration", before_revision AS "beforeRevision",
          after_revision AS "afterRevision", cart_row_id AS "cartRowId", cart_updated_at AS "cartUpdatedAt"
        FROM storefront_local_cart_effects
        WHERE merchant_id = ${scope.merchantId} AND conversation_id = ${scope.conversationId}
          AND cart_id = ${scope.cartId} AND principal_id = ${scope.principalId} AND request_id = ${claim.requestId}::uuid`);
      const validEffect = (effect: z.infer<typeof effectRow>) => sameScope(effect, scope) && effect.requestId === claim.requestId
        && effect.beforeRevision === BigInt(intent.expected_revision) && effect.afterRevision === effect.beforeRevision + 1n;
      if (existing) {
        if (!validEffect(existing) || anchor.revision < existing.afterRevision) throw new Error("storefront_effect_invalid_reference");
        return storefrontClaimedCartEffectResultSchema.parse({ kind: "receipt_required", requestId: existing.requestId,
          effectId: existing.effectId, revision: Number(existing.afterRevision) });
      }
      if (request.state !== "processing") return { kind: "not_current" } as const;
      if (anchor.revision !== BigInt(intent.expected_revision) || anchor.revision === BigInt(Number.MAX_SAFE_INTEGER)) {
        return { kind: "revision_conflict" } as const;
      }

      const previous = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: scope.merchantId, sessionId: scope.cartId } },
        select: { id: true, items: true, couponCode: true } });
      const previousCart = previous === null ? null : existingCartRow.parse(previous);
      if (previousCart) assertSupportedCart(previousCart);
      const lines = (previousCart?.items ?? []).map(line => existingLine.parse(line));
      if (lines.length > 0) {
        const variantIds = [...new Set(lines.map(line => line.variantId))];
        const variants = z.array(existingCatalogRow).max(variantIds.length).parse(await tx.productVariant.findMany({
          where: { id: { in: variantIds }, isActive: true, product: { merchantId: scope.merchantId, isActive: true, deletedAt: null } },
          select: { id: true, product: { select: { id: true, type: true, metadata: true } } },
        }));
        const byId = new Map(variants.map(variant => [variant.id, variant.product]));
        if (variants.length !== variantIds.length || byId.size !== variantIds.length) throw new Error("storefront_effect_cart_catalog_mismatch");
        for (const line of lines) {
          const product = byId.get(line.variantId);
          if (!product || product.id !== line.productId) throw new Error("storefront_effect_cart_catalog_mismatch");
          assertSupportedProduct(product);
        }
      }
      const rawVariant = await tx.productVariant.findFirst({ where: { id: intent.command.args.variantId, isActive: true,
        product: { merchantId: scope.merchantId, isActive: true, deletedAt: null } },
        select: { product: { select: { id: true, type: true, metadata: true } } } });
      if (rawVariant === null) throw new Error("storefront_effect_product_unavailable");
      const variant = catalogRow.parse(rawVariant);
      assertSupportedProduct(variant.product);
      const resolved = Object.freeze(storefrontResolvedLocalCartItemSchema.parse(await resolveItem(tx, scope, intent)));
      if (resolved.productId !== variant.product.id) throw new Error("storefront_effect_product_mismatch");
      if (lines.some(line => line.variantId === intent.command.args.variantId
        && (line.productId !== resolved.productId || line.unitPriceCents !== resolved.unitPriceCents))) {
        throw new Error("storefront_effect_existing_price_or_product_changed");
      }
      const added = await cart.addItem(scope.merchantId, scope.cartId, { ...resolved, variantId: intent.command.args.variantId, quantity: intent.command.args.quantity });
      const outcome = storefrontLocalCartCommercialOutcomeV1Schema.parse(await evaluateRules(tx, scope, frozenCart(added)));
      const originalLines = new Map(added.items.map(item => [item.variantId, item]));
      if (originalLines.size !== added.items.length || outcome.quote.items.length !== added.items.length
        || outcome.quote.originalSubtotalCents !== added.total || outcome.quote.items.some(line => {
          const original = originalLines.get(line.variantId);
          return !original || original.productId !== line.productId || original.quantity !== line.quantity
            || original.unitPriceCents !== line.baseUnitPriceCents;
        })) throw new Error("storefront_effect_quote_cart_mismatch");
      // P lives only in the validated transient quote; storage always keeps base
      // prices and ONLY the extra cart target D. Never persist the quote itself.
      const persistence = storefrontLocalCartRuleOutcomeSchema.parse({ discountCents: outcome.discountCents, freeShipping: false });
      const saved = await cart.applyRuleOutcome(scope.merchantId, scope.cartId, persistence, added);
      const reference = z.strictObject({ cartRowId: id, cartUpdatedAt: z.date() }).parse({ cartRowId: saved.id, cartUpdatedAt: saved.updatedAt });
      const inserted = single(effectRow, await tx.$queryRaw`
        INSERT INTO storefront_local_cart_effects (request_id, merchant_id, conversation_id, cart_id, principal_id,
          claim_generation, before_revision, after_revision, cart_row_id, cart_updated_at)
        VALUES (${claim.requestId}::uuid, ${scope.merchantId}, ${scope.conversationId}, ${scope.cartId}, ${scope.principalId},
          ${BigInt(claim.claimGeneration)}, ${BigInt(intent.expected_revision)}, ${BigInt(intent.expected_revision) + 1n},
          ${reference.cartRowId}, ${reference.cartUpdatedAt})
        RETURNING effect_id AS "effectId", request_id AS "requestId", merchant_id AS "merchantId", conversation_id AS "conversationId",
          cart_id AS "cartId", principal_id AS "principalId", claim_generation AS "claimGeneration", before_revision AS "beforeRevision",
          after_revision AS "afterRevision", cart_row_id AS "cartRowId", cart_updated_at AS "cartUpdatedAt"`);
      if (!inserted || !validEffect(inserted) || inserted.cartRowId !== reference.cartRowId
        || inserted.cartUpdatedAt.getTime() !== reference.cartUpdatedAt.getTime()) throw new Error("storefront_effect_invalid_insert_result");
      return storefrontClaimedCartEffectResultSchema.parse({ kind: "effect_recorded", requestId: inserted.requestId,
        effectId: inserted.effectId, revision: Number(inserted.afterRevision) });
    });
    return storefrontClaimedCartEffectResultSchema.parse(result);
  }
}

