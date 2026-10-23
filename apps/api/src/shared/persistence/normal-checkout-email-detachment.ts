import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import type { CheckoutSession } from "@zyon/shared-types";
import { z } from "zod";
import type { ChatExchangeClaim } from "../../modules/checkout/domain/ports/checkout-session.repository.port.js";
import { checkoutEmailOtpVerificationScopeSchema, type CheckoutEmailOtpVerificationScope } from "../../modules/checkout/domain/services/checkout-email-otp-verification.js";
import { toCheckoutSession } from "../../modules/checkout/domain/services/checkout-session-projection.js";
import { assertCheckoutBuyerIdentityChatClaim, appendCheckoutBuyerIdentityDetachment, requireCheckoutBuyerIdentityReview } from "./checkout-buyer-identity-transition.js";
import { lockStorefrontCart } from "./storefront-cart-lock.js";
import { assertNormalCheckoutIdentityHasNoPersonalOwner } from "./normal-checkout-identity-owner.js";
import { hasNormalCheckoutAcceptance } from "./normal-checkout-acceptance-presence.js";
import { lockNormalCheckoutCrossSell, readNormalCheckoutCrossSellAuthority } from "../../modules/cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.authority.js";

const commandSchema = z.strictObject({ expectedVersion: z.number().int().nonnegative(), email: z.string().trim().email().max(254).transform(value => value.toLowerCase()) });
type Command = z.input<typeof commandSchema>;
type Authority = Pick<Awaited<ReturnType<typeof readNormalCheckoutCrossSellAuthority>>, "stored" | "acceptanceEventIds" | "basisHash" | "source">;
type Dependencies = { readAuthority?: (tx: Prisma.TransactionClient, scope: CheckoutEmailOtpVerificationScope, claim?: ChatExchangeClaim) => Promise<Authority> };

/** An accepted public P may remain on its session after privacy detachment.
 * This command authenticates nobody; only the subsequent real OTP can do so. */
async function performDetachment(tx: Prisma.TransactionClient, rawScope: CheckoutEmailOtpVerificationScope,
  rawCommand: Command, claim?: ChatExchangeClaim, dependencies: Dependencies = {}): Promise<CheckoutSession | undefined> {
  const scope = checkoutEmailOtpVerificationScopeSchema.parse(rawScope), command = commandSchema.parse(rawCommand);
  await lockNormalCheckoutCrossSell(tx, scope);
  const stored = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: scope } });
  if (!stored || stored.merchantId !== scope.merchantId || stored.sessionId !== scope.sessionId) return requireCheckoutBuyerIdentityReview();
  if (!await hasNormalCheckoutAcceptance(tx, scope)) return undefined;
  if (stored.version !== command.expectedVersion) throw new ConflictException("CHECKOUT_SESSION_VERSION_CONFLICT");
  const current = toCheckoutSession(stored);
  if (command.email === current.customer?.email?.trim().toLowerCase() || !current.cart.items.some(item => item.crossSellIntent)) return requireCheckoutBuyerIdentityReview();
  await assertCheckoutBuyerIdentityChatClaim(tx, scope, claim, stored.conversationId);
  await assertNormalCheckoutIdentityHasNoPersonalOwner(tx, scope, stored, current);
  if (current.cart.source === "storefront") {
    if (!current.cart.cart_ref) return requireCheckoutBuyerIdentityReview();
    await lockStorefrontCart(tx, scope.merchantId, current.cart.cart_ref);
    await tx.$queryRaw`SELECT id FROM storefront_carts WHERE merchant_id=${scope.merchantId} AND session_id=${current.cart.cart_ref} FOR SHARE`;
  }
  const authority = await (dependencies.readAuthority ?? ((client, scoped, owned) =>
    readNormalCheckoutCrossSellAuthority(client, scoped, undefined, { ownChatClaim: owned })))(tx, scope, claim);
  if (authority.stored.id !== stored.id || authority.stored.version !== stored.version || !authority.acceptanceEventIds.length) return requireCheckoutBuyerIdentityReview();
  const buyerId = `usr_${randomUUID()}`;
  if (await tx.buyerAccount.findUnique({ where: { globalUserId: buyerId }, select: { globalUserId: true } })) return requireCheckoutBuyerIdentityReview();
  const [{ now }] = z.array(z.object({ now: z.date() })).length(1).parse(await tx.$queryRaw`SELECT clock_timestamp() AS now`);
  if (authority.source && authority.source.row.expiresAt <= now) return requireCheckoutBuyerIdentityReview();
  // Match the existing privacy correction: account-sourced profile is discarded
  // after verified email; unverified buyer-entered hints retain their old UX.
  const customer = JSON.parse(JSON.stringify({ ...current.customer, email: command.email, email_verified: false,
    otp_code: "", otp_expires_at: "", recognized_buyer: false, isReturning: false, externalCustomerId: undefined,
    asaasCustomerId: undefined, phone_verified: false, phone_otp_code: "",
    ...(current.customer?.email_verified ? { fullName: undefined, cpf: undefined, phone: undefined, address: undefined, address_verified: false } : {}),
  })) as Prisma.InputJsonValue;
  const saved = await tx.checkoutSession.updateMany({ where: { id: stored.id, ...scope, globalUserId: stored.globalUserId, version: stored.version },
    data: { globalUserId: buyerId, customer, shipping: Prisma.DbNull, shippingOptions: Prisma.DbNull, updatedAt: now } });
  if (saved.count !== 1) throw new ConflictException("CHECKOUT_SESSION_VERSION_CONFLICT");
  await appendCheckoutBuyerIdentityDetachment(tx, { ...scope, fromBuyerId: stored.globalUserId, toBuyerId: buyerId,
    fromVersion: stored.version, toVersion: stored.version + 1, acceptanceEventIds: [...authority.acceptanceEventIds].sort(),
    basisHash: authority.basisHash, detachedAt: now.toISOString() });
  const committed = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: scope } });
  if (!committed || committed.version !== stored.version + 1 || committed.globalUserId !== buyerId) return requireCheckoutBuyerIdentityReview();
  const result = toCheckoutSession(committed);
  z.object({ email: z.literal(command.email), email_verified: z.literal(false), otp_code: z.literal(""), otp_expires_at: z.literal(""),
    phone_verified: z.literal(false), recognized_buyer: z.literal(false), isReturning: z.literal(false) }).parse(result.customer);
  return result;
}

export async function detachNormalCheckoutBuyerEmailInTransaction(tx: Prisma.TransactionClient, scope: CheckoutEmailOtpVerificationScope,
  command: Command, claim?: ChatExchangeClaim, dependencies: Dependencies = {}): Promise<CheckoutSession | undefined> {
  try { return await performDetachment(tx, scope, command, claim, dependencies); }
  catch (error) {
    if (error instanceof Error && ["checkout_buyer_identity_review_required", "cross_sell_quote_review_required"].includes(error.message))
      throw new ConflictException("checkout_buyer_identity_review_required");
    throw error;
  }
}
