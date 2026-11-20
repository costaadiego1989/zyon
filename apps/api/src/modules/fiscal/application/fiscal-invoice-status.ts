export function fiscalPublicReasonCode(value: string | null): string | null {
  return value &&
    /^[a-z][a-z0-9_.:-]{0,159}$/.test(value) &&
    !/[a-f0-9]{64}/.test(value)
    ? value
    : null;
}

/** A projection of persisted fiscal stock events; it does not create or verify stock evidence. */
export function fiscalStockStatus(
  owner: string,
  events: readonly { action: string }[],
  reason: string | null
) {
  if (owner === "zyon") return { owner, state: "managed_by_zyon" as const };
  if (owner !== "provider") throw new Error("fiscal_stock_owner_invalid");
  if (events.some((event) => event.action === "stock_barrier_released"))
    return { owner, state: "released" as const };
  if (events.some((event) => event.action === "stock_effect_reconciled"))
    return {
      owner,
      state: "evidence_confirmed" as const,
      reasonCode: "fiscal_stock_release_pending",
    };
  const code = fiscalPublicReasonCode(reason);
  return {
    owner,
    state: "awaiting_provider_evidence" as const,
    reasonCode: code?.startsWith("fiscal_stock_")
      ? code
      : "fiscal_stock_evidence_pending",
  };
}
