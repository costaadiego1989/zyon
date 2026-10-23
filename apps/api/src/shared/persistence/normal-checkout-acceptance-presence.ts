import type { Prisma } from "@prisma/client";
import { normalCrossSellEventId } from "../../modules/cross-sell/infrastructure/repositories/prisma-normal-checkout-cross-sell.authority.js";
import { requireCheckoutBuyerIdentityReview } from "./checkout-buyer-identity-transition.js";

/** Presence-only dispatch. Either durable table, even incomplete evidence,
 * prevents falling back to legacy generic identity writers. No grant here. */
export async function hasNormalCheckoutAcceptance(tx: Prisma.TransactionClient, scope: { merchantId: string; sessionId: string }): Promise<boolean> {
  const suggestions = await tx.crossSellSuggestion.findMany({ where: { ...scope, status: "accepted" }, select: { id: true }, take: 201 });
  if (suggestions.length > 200) return requireCheckoutBuyerIdentityReview();
  const eventIds = suggestions.map(value => normalCrossSellEventId(scope, value.id));
  const outbox = await tx.outboxMessage.findFirst({ where: { merchantId: scope.merchantId,
    OR: [{ eventId: { in: eventIds } }, { eventType: "cross-sell.offer.accepted", producer: "cross-sell",
      payload: { path: ["ack", "sessionId"], equals: scope.sessionId } }] }, select: { eventId: true } });
  const event = await tx.checkoutEvent.findFirst({ where: { ...scope, eventName: "cross_sell_accepted",
    metadata: { path: ["acceptance_event_id"], string_starts_with: "normal_cross_sell_" } }, select: { id: true } });
  return !!outbox || !!event;
}
