import { createHash, randomUUID } from "node:crypto";
import type { CashbackBalance, CashbackRules, CashbackTransaction } from "@zyon/shared-types";
import { validateCombination } from "./cashback-combination.js";

export const MAX_MONEY = 1_000_000_000_000;
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
export function fingerprint(value: unknown): string { return createHash("sha256").update(canonical(value)).digest("hex"); }
export class CashbackError extends Error {
  constructor(public readonly code: string, public readonly status = 400) { super(code); }
}

export function cents(value: unknown, name = "amount", allowZero = true): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > MAX_MONEY) {
    throw new CashbackError(`cashback_${name}_invalid`);
  }
  return value;
}

export function validateRules(value: unknown): CashbackRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CashbackError("cashback_rules_required");
  const r = value as Record<string, unknown>;
  const fields = ["earnRateBps", "minimumEarnCents", "maximumEarnPerOrderCents", "buyerMonthlyEarnLimitCents", "monthlyBudgetCents", "releaseTrigger", "releaseDelayDays", "expiryDays", "minimumRedeemOrderCents", "maximumRedeemBps", "maximumRedeemCents", "allowWithDiscounts", "terms"];
  for (const key of fields) if (!Object.hasOwn(r, key) || r[key] === undefined) throw new CashbackError(`cashback_rule_${key}_required`);
  if (Object.keys(r).some(key => !fields.includes(key) && key !== "combination")) throw new CashbackError("cashback_unknown_rule");
  if (Object.hasOwn(r, "combination")) validateCombination(r.combination);
  for (const key of ["minimumEarnCents", "minimumRedeemOrderCents"]) cents(r[key], key);
  for (const key of ["maximumEarnPerOrderCents", "buyerMonthlyEarnLimitCents", "monthlyBudgetCents", "maximumRedeemCents"]) if (r[key] !== null) cents(r[key], key, false);
  cents(r.earnRateBps, "rate", false); cents(r.maximumRedeemBps, "redeem_rate", false);
  if ((r.earnRateBps as number) > 10000 || (r.maximumRedeemBps as number) >= 10000) throw new CashbackError("cashback_rate_out_of_range");
  if (!["payment_confirmed", "order_fulfilled"].includes(String(r.releaseTrigger))) throw new CashbackError("cashback_release_trigger_invalid");
  cents(r.releaseDelayDays, "release_delay");
  if ((r.releaseDelayDays as number) > 365) throw new CashbackError("cashback_release_delay_invalid");
  if (r.expiryDays !== null && (cents(r.expiryDays, "expiry", false) > 3650)) throw new CashbackError("cashback_expiry_invalid");
  if (typeof r.allowWithDiscounts !== "boolean") throw new CashbackError("cashback_discount_policy_required");
  if (typeof r.terms !== "string" || r.terms.trim().length < 10 || r.terms.length > 10000) throw new CashbackError("cashback_terms_required");
  return { ...r, terms: r.terms.trim() } as unknown as CashbackRules;
}

export function rate(amountCents: number, bps: number): number {
  cents(amountCents); cents(bps, "rate");
  return Number(BigInt(amountCents) * BigInt(bps) / 10000n);
}

export function earned(baseCents: number, usedCents: number, rules: CashbackRules): number {
  cents(baseCents); cents(usedCents);
  if (usedCents > baseCents) throw new CashbackError("cashback_use_exceeds_products");
  const net = baseCents - usedCents;
  if (net < rules.minimumEarnCents) return 0;
  return Math.min(rate(net, rules.earnRateBps), rules.maximumEarnPerOrderCents ?? MAX_MONEY);
}

/** Exact largest-remainder allocation, with input-order tie breaking. */
export function allocate(total: number, weights: number[]): number[] {
  cents(total); weights.forEach(w => cents(w));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!Number.isSafeInteger(sum) || sum > MAX_MONEY) throw new CashbackError("cashback_allocation_invalid");
  if (sum === 0) { if (total !== 0) throw new CashbackError("cashback_allocation_invalid"); return weights.map(() => 0); }
  const denominator = BigInt(sum);
  const result = weights.map(w => Number(BigInt(total) * BigInt(w) / denominator));
  let remaining = total - result.reduce((a, b) => a + b, 0);
  const order = weights.map((w, i) => ({ i, remainder: BigInt(total) * BigInt(w) % denominator }))
    .sort((a, b) => a.remainder === b.remainder ? a.i - b.i : a.remainder > b.remainder ? -1 : 1);
  for (const { i } of order) { if (!remaining) break; result[i]!++; remaining--; }
  return result;
}

export interface CashbackOrderLine {
  key: string; variantId: string; quantity: number; grossCents: number; discountCents: number; cashbackCents: number;
}
export interface Grant {
  id: string; orderId: string; originalCents: number; pendingCents: number; availableCents: number;
  reservedCents: number; usedCents: number; expiredCents: number; reversedCents: number; lossCents: number;
  eligibleBaseCents: number; refundedBaseCents: number; ruleVersion: number; rules: CashbackRules;
  availableAt: string | null; expiresAt: string | null; createdAt: string; lines: CashbackOrderLine[];
}
export interface Allocation { grantId: string; amountCents: number; restoredCents: number; revokedCents: number; }
export interface Reservation {
  id: string; sessionId: string; fingerprint: string; amountCents: number; allocations: Allocation[];
  state: "reserved" | "payment_pending" | "consumed" | "released"; createdAt: string; expiresAt: string;
  paymentKey: string | null; paymentIntentId: string | null; orderId: string | null; refundedCents: number;
}
export interface Wallet {
  merchantId: string; buyerId: string; grants: Grant[]; reservations: Reservation[]; entries: CashbackTransaction[];
}
export function emptyWallet(merchantId: string, buyerId: string): Wallet {
  return { merchantId, buyerId, grants: [], reservations: [], entries: [] };
}
function entry(w: Wallet, type: CashbackTransaction["type"], amountCents: number, now: Date,
  extra: Partial<CashbackTransaction> = {}): void {
  if (!Number.isSafeInteger(amountCents) || Math.abs(amountCents) > MAX_MONEY) throw new CashbackError("cashback_ledger_amount_invalid");
  w.entries.push({ id: randomUUID(), merchantId: w.merchantId, buyerId: w.buyerId, type, amountCents,
    orderId: null, sessionId: null, reason: type, actorId: null, occurredAt: now.toISOString(), ...extra });
}
export function walletBalance(w: Wallet): CashbackBalance {
  const sum = (key: keyof Grant) => {
    const value = w.grants.reduce((s, g) => s + Number(g[key]), 0);
    if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY) throw new CashbackError("cashback_wallet_limit_exceeded", 409);
    return value;
  };
  const expiring = w.grants.filter(g => g.availableCents > 0 && g.expiresAt).sort((a, b) => a.expiresAt!.localeCompare(b.expiresAt!));
  const nextExpiryAt = expiring[0]?.expiresAt ?? null;
  return { pendingCents: sum("pendingCents"), availableCents: sum("availableCents"), reservedCents: sum("reservedCents"),
    earnedCents: sum("originalCents"), usedCents: sum("usedCents"), expiredCents: sum("expiredCents"),
    reversedCents: sum("reversedCents"), lossCents: sum("lossCents"), nextExpiryAt,
    nextExpiryCents: expiring.filter(g => g.expiresAt === nextExpiryAt).reduce((s, g) => s + g.availableCents, 0) };
}

export function assertWallet(w: Wallet): void {
  for (const g of w.grants) {
    const buckets = [g.originalCents, g.pendingCents, g.availableCents, g.reservedCents, g.usedCents, g.expiredCents, g.reversedCents, g.lossCents];
    if (buckets.some(v => !Number.isSafeInteger(v) || v < 0 || v > MAX_MONEY)) throw new CashbackError("cashback_wallet_invariant", 409);
    const revokedReservations = w.reservations.filter(r => ["reserved", "payment_pending"].includes(r.state))
      .flatMap(r => r.allocations).filter(a => a.grantId === g.id).reduce((s, a) => s + a.revokedCents, 0);
    if (g.originalCents + g.lossCents + revokedReservations !== g.pendingCents + g.availableCents + g.reservedCents + g.usedCents + g.expiredCents + g.reversedCents) {
      throw new CashbackError("cashback_wallet_invariant", 409);
    }
  }
}

export function grantCredit(w: Wallet, input: { orderId: string; amountCents: number; eligibleBaseCents: number; rules: CashbackRules; ruleVersion: number; lines: CashbackOrderLine[]; availableAt: string | null }, now: Date): Grant | null {
  cents(input.amountCents);
  if (input.amountCents === 0) return null;
  if (w.grants.some(g => g.orderId === input.orderId)) throw new CashbackError("cashback_order_already_credited", 409);
  const g: Grant = { id: randomUUID(), orderId: input.orderId, originalCents: input.amountCents, pendingCents: input.amountCents,
    availableCents: 0, reservedCents: 0, usedCents: 0, expiredCents: 0, reversedCents: 0, lossCents: 0,
    eligibleBaseCents: input.eligibleBaseCents, refundedBaseCents: 0, ruleVersion: input.ruleVersion,
    rules: input.rules, lines: input.lines, availableAt: input.availableAt, expiresAt: null, createdAt: now.toISOString() };
  w.grants.push(g); entry(w, "grant", input.amountCents, now, { orderId: input.orderId });
  return g;
}

export function advance(w: Wallet, now: Date): void {
  for (const r of w.reservations) if (r.state === "reserved" && new Date(r.expiresAt) <= now) release(w, r.id, now);
  for (const g of w.grants) {
    if (g.pendingCents > 0 && g.availableAt && new Date(g.availableAt) <= now) {
      const amount = g.pendingCents; g.pendingCents = 0; g.availableCents += amount;
      if (g.rules.expiryDays !== null) g.expiresAt = new Date(new Date(g.availableAt).getTime() + g.rules.expiryDays * 86400000).toISOString();
      entry(w, "release", amount, now, { orderId: g.orderId });
    }
    if (g.availableCents > 0 && g.expiresAt && new Date(g.expiresAt) <= now) {
      const amount = g.availableCents; g.availableCents = 0; g.expiredCents += amount;
      entry(w, "expire", amount, now, { orderId: g.orderId });
    }
  }
  assertWallet(w);
}

export function reserve(w: Wallet, input: { sessionId: string; fingerprint: string; amountCents: number; maximumCents: number }, now: Date): Reservation {
  cents(input.amountCents, "reserve", false); cents(input.maximumCents);
  advance(w, now);
  const existing = w.reservations.find(r => r.sessionId === input.sessionId && ["reserved", "payment_pending"].includes(r.state));
  if (existing) {
    if (existing.fingerprint === input.fingerprint && existing.amountCents === input.amountCents) return existing;
    if (existing.state === "payment_pending") throw new CashbackError("cashback_payment_in_progress", 409);
    release(w, existing.id, now);
  }
  if (input.amountCents > input.maximumCents || input.amountCents > walletBalance(w).availableCents) throw new CashbackError("cashback_insufficient_or_ineligible_balance", 409);
  const r: Reservation = { id: randomUUID(), sessionId: input.sessionId, fingerprint: input.fingerprint, amountCents: input.amountCents,
    state: "reserved", allocations: [], createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 15 * 60000).toISOString(),
    paymentKey: null, paymentIntentId: null, orderId: null, refundedCents: 0 };
  let left = input.amountCents;
  const lots = [...w.grants].filter(g => g.availableCents > 0).sort((a, b) => (a.expiresAt ?? "9999").localeCompare(b.expiresAt ?? "9999") || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const g of lots) {
    const amount = Math.min(left, g.availableCents); if (!amount) break;
    g.availableCents -= amount; g.reservedCents += amount; left -= amount;
    r.allocations.push({ grantId: g.id, amountCents: amount, restoredCents: 0, revokedCents: 0 });
  }
  w.reservations.push(r); entry(w, "reserve", input.amountCents, now, { sessionId: input.sessionId }); assertWallet(w);
  return r;
}

export function release(w: Wallet, id: string, now: Date, definitiveFailure = false): void {
  const r = w.reservations.find(r => r.id === id);
  if (!r || r.state === "released") return;
  if (r.state === "consumed" || (r.state === "payment_pending" && !definitiveFailure)) throw new CashbackError("cashback_payment_in_progress", 409);
  for (const a of r.allocations) {
    const g = w.grants.find(g => g.id === a.grantId)!;
    g.reservedCents -= a.amountCents;
    const restored = a.amountCents - a.revokedCents;
    if (g.expiresAt && new Date(g.expiresAt) <= now) g.expiredCents += restored;
    else g.availableCents += restored;
    a.revokedCents = 0;
  }
  r.state = "released"; entry(w, "unreserve", r.amountCents, now, { sessionId: r.sessionId }); assertWallet(w);
}

/** Shrinks only unbound credit; existing provider commitments are immutable. */
export function shrinkReservation(w: Wallet, id: string, maximumCents: number, nextFingerprint: string, now: Date): void {
  cents(maximumCents);
  const r = w.reservations.find(row => row.id === id);
  if (!r || r.state === "released" || r.state === "consumed") return;
  if (r.state === "payment_pending") throw new CashbackError("cashback_payment_in_progress", 409);
  const target = Math.min(maximumCents, r.amountCents);
  if (target === 0) { release(w, r.id, now); return; }
  let remaining = r.amountCents - target; const freed = remaining;
  for (const a of [...r.allocations].reverse()) {
    const take = Math.min(remaining, a.amountCents); if (!take) continue;
    const g = w.grants.find(grant => grant.id === a.grantId)!;
    const revoked = Math.min(take, a.revokedCents);
    g.reservedCents -= take; a.amountCents -= take; a.revokedCents -= revoked; remaining -= take;
    if (g.expiresAt && new Date(g.expiresAt) <= now) g.expiredCents += take - revoked;
    else g.availableCents += take - revoked;
  }
  r.allocations = r.allocations.filter(a => a.amountCents > 0); r.amountCents = target; r.fingerprint = nextFingerprint;
  if (freed) entry(w, "unreserve", freed, now, { sessionId: r.sessionId, reason: "cashback_combined_limit_recalculated" });
  assertWallet(w);
}

export function consume(w: Wallet, id: string, orderId: string, now: Date): void {
  const r = w.reservations.find(r => r.id === id);
  if (!r) throw new CashbackError("cashback_reservation_missing", 409);
  if (r.state === "consumed") { if (r.orderId !== orderId) throw new CashbackError("cashback_order_mismatch", 409); return; }
  if (r.state !== "payment_pending") throw new CashbackError("cashback_reservation_not_bound", 409);
  for (const a of r.allocations) {
    const g = w.grants.find(g => g.id === a.grantId)!;
    g.reservedCents -= a.amountCents; g.usedCents += a.amountCents; g.lossCents += a.revokedCents;
    if (a.revokedCents) entry(w, "loss", a.revokedCents, now, { orderId: g.orderId, reason: "source_credit_reversed_during_payment" });
    a.revokedCents = 0;
  }
  r.state = "consumed"; r.orderId = orderId;
  entry(w, "redeem", r.amountCents, now, { sessionId: r.sessionId, orderId }); assertWallet(w);
}

export function reverseGrant(w: Wallet, orderId: string, cumulativeRefundedBaseCents: number, now: Date): number {
  const g = w.grants.find(g => g.orderId === orderId);
  if (!g) return 0;
  cents(cumulativeRefundedBaseCents);
  if (cumulativeRefundedBaseCents < g.refundedBaseCents || cumulativeRefundedBaseCents > g.eligibleBaseCents) throw new CashbackError("cashback_refund_base_invalid", 409);
  const retained = g.eligibleBaseCents - cumulativeRefundedBaseCents;
  const due = Math.min(g.originalCents, earned(retained, 0, g.rules));
  let remaining = g.originalCents - due - g.reversedCents;
  const reversed = remaining; g.refundedBaseCents = cumulativeRefundedBaseCents;
  for (const key of ["pendingCents", "availableCents", "expiredCents"] as const) {
    const take = Math.min(remaining, g[key]); g[key] -= take; remaining -= take;
  }
  const consumedLoss = Math.min(remaining, g.usedCents - g.lossCents);
  g.lossCents += consumedLoss; remaining -= consumedLoss;
  if (consumedLoss) entry(w, "loss", consumedLoss, now, { orderId, reason: "source_credit_already_spent" });
  if (remaining) for (const r of w.reservations.filter(r => ["reserved", "payment_pending"].includes(r.state))) {
    for (const a of r.allocations.filter(a => a.grantId === g.id)) {
      const take = Math.min(remaining, a.amountCents - a.revokedCents); a.revokedCents += take; remaining -= take;
    }
  }
  if (remaining) throw new CashbackError("cashback_reversal_invariant", 409);
  g.reversedCents += reversed;
  if (reversed) entry(w, "reverse", reversed, now, { orderId }); assertWallet(w); return reversed;
}

export function restore(w: Wallet, orderId: string, cumulativeCents: number, now: Date): number {
  const r = w.reservations.find(r => r.orderId === orderId && r.state === "consumed");
  if (!r) return 0;
  cents(cumulativeCents);
  if (cumulativeCents < r.refundedCents || cumulativeCents > r.amountCents) throw new CashbackError("cashback_restore_invalid", 409);
  let remaining = cumulativeCents - r.refundedCents; const restored = remaining;
  for (const a of r.allocations) {
    const take = Math.min(remaining, a.amountCents - a.restoredCents); if (!take) continue;
    const g = w.grants.find(g => g.id === a.grantId)!;
    g.usedCents -= take; a.restoredCents += take; remaining -= take;
    const voided = Math.min(take, g.lossCents); g.lossCents -= voided;
    const valid = take - voided;
    if (g.expiresAt && new Date(g.expiresAt) <= now) g.expiredCents += valid;
    else g.availableCents += valid;
  }
  r.refundedCents = cumulativeCents;
  if (restored) entry(w, "restore", restored, now, { orderId, sessionId: r.sessionId, reason: "refund_preserves_original_credit_validity" });
  assertWallet(w); return restored;
}

export function adjust(w: Wallet, amountCents: number, reason: string, actorId: string, expiryDays: number | null, now: Date): void {
  if (!Number.isSafeInteger(amountCents) || amountCents === 0 || Math.abs(amountCents) > MAX_MONEY || reason.trim().length < 5 || reason.length > 1000 || !actorId) throw new CashbackError("cashback_adjustment_invalid");
  advance(w, now);
  if (amountCents > 0) {
    if (expiryDays !== null && (!Number.isSafeInteger(expiryDays) || expiryDays < 1 || expiryDays > 3650)) throw new CashbackError("cashback_expiry_invalid");
    const rules: CashbackRules = { earnRateBps: 10000, minimumEarnCents: 0, maximumEarnPerOrderCents: null, buyerMonthlyEarnLimitCents: null,
      monthlyBudgetCents: null, releaseTrigger: "payment_confirmed", releaseDelayDays: 0, expiryDays, minimumRedeemOrderCents: 0, maximumRedeemBps: 9999,
      maximumRedeemCents: null, allowWithDiscounts: true, terms: "Ajuste manual autorizado pelo lojista." };
    const g = grantCredit(w, { orderId: `adjustment:${randomUUID()}`, amountCents, eligibleBaseCents: amountCents, rules, ruleVersion: 0, lines: [], availableAt: now.toISOString() }, now)!;
    // Manual adjustments do not masquerade as purchase grants.
    w.entries.pop(); g.pendingCents = 0; g.availableCents = amountCents;
    g.expiresAt = expiryDays === null ? null : new Date(now.getTime() + expiryDays * 86400000).toISOString();
  } else {
    if (-amountCents > walletBalance(w).availableCents) throw new CashbackError("cashback_insufficient_available_for_adjustment", 409);
    let left = -amountCents;
    for (const g of [...w.grants].sort((a, b) => (a.expiresAt ?? "9999").localeCompare(b.expiresAt ?? "9999"))) {
      const take = Math.min(left, g.availableCents); g.availableCents -= take; g.reversedCents += take; left -= take;
    }
  }
  entry(w, "adjustment", amountCents, now, { reason: reason.trim(), actorId }); assertWallet(w);
}
