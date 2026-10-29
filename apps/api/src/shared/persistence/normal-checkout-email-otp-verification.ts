import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { CheckoutSession } from "@zyon/shared-types";
import { z } from "zod";
import type { ChatExchangeClaim } from "../../modules/checkout/domain/ports/checkout-session.repository.port.js";
import { checkoutEmailOtpVerificationCommandSchema, checkoutEmailOtpVerificationScopeSchema,
  CheckoutEmailOtpVerificationError, type CheckoutEmailOtpVerificationCommand, type CheckoutEmailOtpVerificationScope } from "../../modules/checkout/domain/services/checkout-email-otp-verification.js";
import { verifyCheckoutEmailOtp } from "../../modules/checkout/domain/services/checkout-email-otp.js";
import { pickBestPriorCheckoutBuyer } from "../../modules/checkout/domain/services/buyer-recognition.js";
import { toCheckoutSession } from "../../modules/checkout/domain/services/checkout-session-projection.js";
import { lockStorefrontCart } from "./storefront-cart-lock.js";
import { hasNormalCheckoutAcceptance as hasNormalAcceptance } from "./normal-checkout-acceptance-presence.js";
import { assertNormalCheckoutIdentityHasNoPersonalOwner } from "./normal-checkout-identity-owner.js";
import { appendCheckoutBuyerIdentityTransition, assertCheckoutBuyerIdentityChatClaim,
  requireCheckoutBuyerIdentityReview } from "./checkout-buyer-identity-transition.js";
import { lockNormalCheckoutCrossSell, readNormalCheckoutCrossSellAuthority,
  normalCrossSellSuggestionSchema, readNormalCrossSellEvidence } from "../../modules/cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.authority.js";

type Authority = Pick<Awaited<ReturnType<typeof readNormalCheckoutCrossSellAuthority>>, "stored" | "acceptanceEventIds" | "basisHash" | "source">;
type Dependencies = { readAuthority?: (tx: Prisma.TransactionClient, scope: CheckoutEmailOtpVerificationScope, claim?: ChatExchangeClaim) => Promise<Authority> };
const accountSchema = z.object({ globalUserId: z.string().min(1).max(191), email: z.string().email() });
const review = requireCheckoutBuyerIdentityReview;

/** Profile hydration pins the actual current principal. Unlike OTP migration,
 * this read never requires D=0 and never authorizes changing an existing UID. */
export async function readVerifiedNormalCheckoutBuyerIdentityInTransaction(tx: Prisma.TransactionClient,
  rawScope: CheckoutEmailOtpVerificationScope, rawExpected: { expectedVersion: number; expectedBuyerId: string }): Promise<string | undefined> {
  const scope = checkoutEmailOtpVerificationScopeSchema.parse(rawScope), expected = z.strictObject({
    expectedVersion: z.number().int().nonnegative(), expectedBuyerId: checkoutEmailOtpVerificationScopeSchema.shape.sessionId }).parse(rawExpected);
  await lockNormalCheckoutCrossSell(tx, scope);
  const stored = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: scope } });
  if (!stored || stored.merchantId !== scope.merchantId || stored.sessionId !== scope.sessionId) return review();
  if (!await hasNormalAcceptance(tx, scope)) return undefined;
  if (stored.version !== expected.expectedVersion || stored.globalUserId !== expected.expectedBuyerId)
    throw new ConflictException("CHECKOUT_SESSION_VERSION_CONFLICT");
  const session = toCheckoutSession(stored);
  if (session.customer?.email_verified !== true || !session.customer.email?.trim()) return review();
  const accepted = z.array(normalCrossSellSuggestionSchema).min(1).max(200).parse(await tx.crossSellSuggestion.findMany({
    where: { ...scope, status: "accepted" }, orderBy: { id: "asc" }, take: 201 }));
  for (const suggestion of accepted) await readNormalCrossSellEvidence(tx, scope, suggestion, stored.globalUserId);
  return stored.globalUserId;
}

/** Dedicated normal-intent command. Caller owns the SQL transaction. No provider
 * I/O, generic preserve flag, private receipt activation or coupon migration. */
export async function verifyNormalCheckoutEmailOtpInTransaction(tx: Prisma.TransactionClient, rawScope: CheckoutEmailOtpVerificationScope,
  rawCommand: CheckoutEmailOtpVerificationCommand, claim?: ChatExchangeClaim, dependencies: Dependencies = {}): Promise<CheckoutSession | undefined> {
  const scope = checkoutEmailOtpVerificationScopeSchema.parse(rawScope), command = checkoutEmailOtpVerificationCommandSchema.parse(rawCommand);
  await lockNormalCheckoutCrossSell(tx, scope);
  const stored = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: scope } });
  if (!stored || stored.merchantId !== scope.merchantId || stored.sessionId !== scope.sessionId) return review();
  // Presence only routes legacy V1. Check both independent durable tables and
  // exact accepted-suggestion event IDs so malformed payloads cannot hide a
  // normal record and fall back into the generic verified-flag writer.
  if (!await hasNormalAcceptance(tx, scope)) return undefined;
  if (stored.version !== command.expectedVersion) throw new ConflictException("CHECKOUT_SESSION_VERSION_CONFLICT");
  const current = toCheckoutSession(stored), email = current.customer?.email?.trim().toLowerCase();
  if (!email || !z.string().email().safeParse(email).success || current.customer?.email_verified === true
    || !current.cart.items.some(item => item.crossSellIntent !== undefined)) return review();
  await assertCheckoutBuyerIdentityChatClaim(tx, scope, claim, stored.conversationId);
  // Historical rows are not reinterpreted as transferable personal entitlements.
  // Block every payment generation, including failed/unknown historical journals.
  await assertNormalCheckoutIdentityHasNoPersonalOwner(tx, scope, stored, current);
  const [{ now }] = z.array(z.object({ now: z.date() })).length(1).parse(await tx.$queryRaw`SELECT clock_timestamp() AS now`);
  const verified = verifyCheckoutEmailOtp({ code: command.code, challenge: current.customer?.otp_code,
    expiresAt: current.customer?.otp_expires_at, nowMilliseconds: now.getTime() });
  if (verified !== "verified") throw new CheckoutEmailOtpVerificationError(verified);
  if (current.cart.source === "storefront") {
    if (!current.cart.cart_ref) return review();
    await lockStorefrontCart(tx, scope.merchantId, current.cart.cart_ref);
    // The shared advisory fence orders cooperating writers; the actual row lock
    // also prevents direct SQL from changing the no-D source before identity CAS.
    await tx.$queryRaw`SELECT id FROM storefront_carts WHERE merchant_id=${scope.merchantId}
      AND session_id=${current.cart.cart_ref} FOR SHARE`;
  }
  const authority = await (dependencies.readAuthority ?? ((client, scoped, ownClaim) =>
    readNormalCheckoutCrossSellAuthority(client, scoped, undefined, { ownChatClaim: ownClaim })))(tx, scope, claim);
  if (authority.stored.id !== stored.id || authority.stored.version !== stored.version || !authority.acceptanceEventIds.length) return review();
  // Account fields are not copied from raw encrypted storage. Existing profile
  // hydration runs after commit, pinned to the UID proved here.
  await tx.$queryRaw`SELECT global_user_id FROM buyer_accounts WHERE email=${email} FOR SHARE`;
  const rawAccount = await tx.buyerAccount.findUnique({ where: { email }, select: { globalUserId: true, email: true } });
  const account = rawAccount === null ? null : accountSchema.parse(rawAccount);
  if (account && account.email.trim().toLowerCase() !== email) return review();
  let buyerId = account?.globalUserId;
  if (!buyerId) {
    await tx.$queryRaw`SELECT id FROM checkout_sessions WHERE merchant_id=${scope.merchantId}
      AND session_id<>${scope.sessionId} AND lower(trim(customer->>'email'))=${email}
      AND customer->>'email_verified'='true' ORDER BY id FOR SHARE`;
    const prior = await tx.checkoutSession.findMany({ where: { merchantId: scope.merchantId, sessionId: { not: scope.sessionId },
      customer: { path: ["email"], string_contains: email } } });
    buyerId = pickBestPriorCheckoutBuyer(prior.map(toCheckoutSession), scope.sessionId, email)?.globalUserId ?? current.globalUserId;
  }
  const [{ now: consumedAt }] = z.array(z.object({ now: z.date() })).length(1).parse(await tx.$queryRaw`SELECT clock_timestamp() AS now`);
  const finalVerification = verifyCheckoutEmailOtp({ code: command.code, challenge: current.customer?.otp_code,
    expiresAt: current.customer?.otp_expires_at, nowMilliseconds: consumedAt.getTime() });
  if (finalVerification !== "verified") throw new CheckoutEmailOtpVerificationError(finalVerification);
  if (consumedAt < now || authority.source && authority.source.row.expiresAt <= consumedAt) return review();
  // The domain mapper exposes this same stored JSON as CustomerHints. Preserve
  // its actual nested address/value/absence semantics without asserting that an
  // interface with no JSON index signature is a Prisma JSON value.
  const storedCustomer=stored.customer!==null&&typeof stored.customer==="object"&&!Array.isArray(stored.customer)?stored.customer:{};
  const customer:Prisma.InputJsonObject = { ...storedCustomer, email, email_verified: true, otp_code: "", otp_expires_at: "" };
  const changed = await tx.checkoutSession.updateMany({ where: { id: stored.id, ...scope, version: stored.version,
    globalUserId: stored.globalUserId }, data: { globalUserId: buyerId, customer,
      ...(buyerId !== stored.globalUserId ? { shipping: Prisma.DbNull, shippingOptions: Prisma.DbNull } : {}),
      updatedAt: consumedAt } });
  if (changed.count !== 1) throw new ConflictException("CHECKOUT_SESSION_VERSION_CONFLICT");
  await appendCheckoutBuyerIdentityTransition(tx, { ...scope, fromBuyerId: stored.globalUserId, toBuyerId: buyerId,
    fromVersion: stored.version, toVersion: stored.version + 1, acceptanceEventIds: [...authority.acceptanceEventIds].sort(),
    basisHash: authority.basisHash, verifiedAt: consumedAt.toISOString() });
  const committed = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: scope } });
  if (!committed || committed.version !== stored.version + 1 || committed.globalUserId !== buyerId) return review();
  const persistedCustomer = z.object({ email: z.string().email(), email_verified: z.literal(true), otp_code: z.literal(""),
    otp_expires_at: z.literal("") }).parse(committed.customer);
  if (persistedCustomer.email !== email) return review();
  return toCheckoutSession(committed);
}

