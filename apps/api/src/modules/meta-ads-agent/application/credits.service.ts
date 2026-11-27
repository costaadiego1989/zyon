import type { MetaAdsWallet, MetaAdsMedia } from "@zyon/shared-types";
import { MetaAdsError, type MetaAdsStoreState, type MetaAdsRepository, type CreditReservation, type CommerceContextPort, type Clock } from "../domain/types.js";
import { requireEntitlement, requireIdentifier } from "../domain/offer.js";

function availableMonthly(state: MetaAdsStoreState, now: Date): number {
  return state.credits.periodEndsAt && new Date(state.credits.periodEndsAt).getTime() > now.getTime() ? state.credits.monthlyAvailable : 0;
}
export function reserveCredits(state: MetaAdsStoreState, id: string, count: number, now: Date): CreditReservation {
  requireIdentifier(id);
  if (!Number.isSafeInteger(count) || count < 1 || count > 30) throw new MetaAdsError("image_count_invalid");
  const existing = Object.hasOwn(state.credits.reservations, id) ? state.credits.reservations[id] : undefined;
  if (existing) {
    if (existing.requested !== count) throw new MetaAdsError("credit_reservation_conflict", 409);
    return existing;
  }
  const monthly = Math.min(count, availableMonthly(state, now)); const extra = count - monthly;
  if (extra > state.credits.extraAvailable) throw new MetaAdsError("image_credits_insufficient", 409);
  state.credits.monthlyAvailable -= monthly; state.credits.extraAvailable -= extra;
  const reservation: CreditReservation = { id, periodKey: state.credits.periodKey, monthly, extra, requested: count, status: "reserved", used: 0 };
  Object.defineProperty(state.credits.reservations, id, { value: reservation, enumerable: true, writable: true, configurable: true });
  return reservation;
}
export function settleCredits(state: MetaAdsStoreState, id: string, used: number): CreditReservation {
  const reservation = Object.hasOwn(state.credits.reservations, id) ? state.credits.reservations[id] : undefined;
  if (!reservation) throw new MetaAdsError("credit_reservation_missing", 404);
  if (!Number.isSafeInteger(used) || used < 0 || used > reservation.requested) throw new MetaAdsError("image_count_invalid");
  if (["settled", "released"].includes(reservation.status)) {
    if (reservation.used !== used) throw new MetaAdsError("credit_settlement_conflict", 409);
    return reservation;
  }
  const monthlyUsed = Math.min(used, reservation.monthly); const extraUsed = used - monthlyUsed;
  if (reservation.periodKey === state.credits.periodKey) state.credits.monthlyAvailable += reservation.monthly - monthlyUsed;
  state.credits.extraAvailable += reservation.extra - extraUsed;
  reservation.used = used; reservation.status = used ? "settled" : "released";
  return reservation;
}
export function creditWallet(state: MetaAdsStoreState, now: Date): MetaAdsWallet {
  return { monthlyAvailable: availableMonthly(state, now), extraAvailable: state.credits.extraAvailable,
    reserved: Object.values(state.credits.reservations).filter(r => ["reserved", "unknown"].includes(r.status)).reduce((sum, r) => sum + r.requested, 0),
    periodKey: state.credits.periodKey, periodEndsAt: state.credits.periodEndsAt };
}

export class CreditsService {
  constructor(private readonly repo: MetaAdsRepository, private readonly commerce: Pick<CommerceContextPort, "getPlan">, private readonly clock: Clock = () => new Date()) {}

  async reserve(merchantId: string, id: string, count: number): Promise<CreditReservation> {
    const plan = await this.commerce.getPlan(merchantId);
    return this.repo.mutate(merchantId, [], state => {
      requireEntitlement(plan, state, this.clock());
      return { result: reserveCredits(state, id, count, this.clock()) };
    });
  }
  async settle(merchantId: string, id: string, used: number): Promise<CreditReservation> {
    // Reconcile already paid work even after an entitlement expires.
    return this.repo.mutate(merchantId, [], state => ({ result: settleCredits(state, id, used) }));
  }
  async markUnknown(merchantId: string, id: string): Promise<void> {
    await this.repo.mutate(merchantId, [], state => {
      const reservation = Object.hasOwn(state.credits.reservations, id) ? state.credits.reservations[id] : undefined;
      if (!reservation) throw new MetaAdsError("credit_reservation_missing", 404);
      if (reservation.status === "reserved") reservation.status = "unknown";
      return { result: undefined };
    });
  }
  async wallet(merchantId: string): Promise<MetaAdsWallet> { return creditWallet(await this.repo.read(merchantId), this.clock()); }

  async reuse(merchantId: string, mediaId: string): Promise<MetaAdsMedia> {
    const state = await this.repo.read(merchantId);
    requireEntitlement(await this.commerce.getPlan(merchantId), state, this.clock());
    if (!Object.hasOwn(state.media, mediaId)) throw new MetaAdsError("media_not_found", 404);
    return state.media[mediaId];
  }
}
