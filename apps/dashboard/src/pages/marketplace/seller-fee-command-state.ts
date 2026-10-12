export type SellerFeeScope = { merchantId: string; userId: string; family?: "seller" | "host" };
export type SellerFeeStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PendingSellerFee = { id: string; grossCents: number; feeCertificateId: string; environment: "test" | "live" };
const identity = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const key = (s: SellerFeeScope, operation: string, id: string) => {
  if (!identity(s.merchantId) || !identity(s.userId) || !identity(id)) throw new Error("seller_fee_storage_invalid_scope");
  if (s.family !== undefined && s.family !== "seller" && s.family !== "host") throw new Error("seller_fee_storage_invalid_scope");
  return `zyon:${s.family ?? "seller"}-fee-collection:v1:${encodeURIComponent(s.merchantId)}:${encodeURIComponent(s.userId)}:${operation}:${encodeURIComponent(id)}`;
};
export function sellerFeeSubmissionExists(store: SellerFeeStorage, scope: SellerFeeScope, id: string, operation: "submission" | "excess" = "submission"): boolean {
  // Any persisted marker blocks another submission, including an interrupted
  // write or a marker from a newer client version.
  return store.getItem(key(scope, operation, id)) !== null;
}
export function rememberSellerFeeSubmission(store: SellerFeeStorage, scope: SellerFeeScope, id: string, operation: "submission" | "excess" = "submission"): void {
  const marker = key(scope, operation, id);
  if (store.getItem(marker) !== null) throw new Error("seller_fee_submission_already_sent");
  store.setItem(marker, "submitted");
  if (store.getItem(marker) !== "submitted") throw new Error("seller_fee_storage_unavailable");
}
export function pendingSellerFeeApproval(store: SellerFeeStorage, scope: SellerFeeScope, debtId: string): PendingSellerFee | null {
  const raw = store.getItem(key(scope, "approval", debtId)); if (raw === null) return null;
  let v: PendingSellerFee;
  try { v = JSON.parse(raw) as PendingSellerFee; } catch { throw new Error("seller_fee_storage_invalid"); }
  if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).sort().join(",") !== "environment,feeCertificateId,grossCents,id" ||
    !identity(v.id) || !identity(v.feeCertificateId) || !["test", "live"].includes(v.environment) ||
    !Number.isSafeInteger(v.grossCents) || v.grossCents < (scope.family === "host" ? 50 : 1) || v.grossCents > 2_147_483_647) throw new Error("seller_fee_storage_invalid");
  return v;
}
export function rememberSellerFeeApproval(store: SellerFeeStorage, scope: SellerFeeScope, debtId: string, value: PendingSellerFee): void {
  const marker = key(scope, "approval", debtId);
  if (store.getItem(marker) !== null) throw new Error("seller_fee_approval_already_submitted");
  // Validate before persisting, so malformed drafts never poison a valid key.
  pendingSellerFeeApproval({ ...store, getItem: () => JSON.stringify(value) }, scope, debtId);
  store.setItem(marker, JSON.stringify(value));
  const saved = pendingSellerFeeApproval(store, scope, debtId);
  if (!saved || JSON.stringify(saved) !== JSON.stringify(value)) throw new Error("seller_fee_storage_unavailable");
}
export function clearTerminalSellerFeeApproval(store: SellerFeeStorage, scope: SellerFeeScope, debtId: string,
  receipt: { collection_id: string; fee_certificate_id: string; environment: string; gross_amount_cents: number; status: string }): void {
  if (receipt.status !== "credited" && receipt.status !== "expired") return;
  const old = pendingSellerFeeApproval(store, scope, debtId);
  if (old?.id === receipt.collection_id && old.feeCertificateId === receipt.fee_certificate_id && old.environment === receipt.environment && old.grossCents === receipt.gross_amount_cents)
    store.removeItem(key(scope, "approval", debtId));
}
export function parseSellerFeeAmount(value: string): number | null {
  if (!/^\d{1,8}(?:[.,]\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().replace(",", ".").split(".");
  const valueCents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(valueCents) && valueCents > 0 && valueCents <= 2_147_483_647 ? valueCents : null;
}
