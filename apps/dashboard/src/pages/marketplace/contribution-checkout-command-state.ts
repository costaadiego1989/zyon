export type ContributionScope = { merchantId: string; userId: string };
export type ContributionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type PendingContribution = { id: string; grossCents: number };
const key = (s: ContributionScope, operation: string, id: string) => `zyon:contribution-checkout:v1:${encodeURIComponent(s.merchantId)}:${encodeURIComponent(s.userId)}:${operation}:${encodeURIComponent(id)}`;
export function contributionSubmissionExists(store: ContributionStorage, scope: ContributionScope, id: string, operation: "execute" | "excess"): boolean {
  return store.getItem(key(scope, operation, id)) !== null;
}
export function rememberContributionSubmission(store: ContributionStorage, scope: ContributionScope, id: string, operation: "execute" | "excess"): void {
  const marker = key(scope, operation, id); store.setItem(marker, "submitted");
  if (store.getItem(marker) !== "submitted") throw new Error("contribution_storage_unavailable");
}
export function pendingContributionApproval(store: ContributionStorage, scope: ContributionScope, refundId: string): PendingContribution | null {
  const raw = store.getItem(key(scope, "approve", refundId)); if (raw === null) return null;
  const value = JSON.parse(raw) as PendingContribution;
  if (!value || !/^[A-Za-z0-9_-]{1,200}$/.test(value.id) || !Number.isSafeInteger(value.grossCents) || value.grossCents < 1 || value.grossCents > 2_147_483_647) throw new Error("contribution_storage_invalid");
  return value;
}
/** Preserve the first approval identity before POST. Lost approval responses
 * can only be recovered with GET for that identity, never a fresh approval. */
export function rememberContributionApproval(store: ContributionStorage, scope: ContributionScope, refundId: string, value: PendingContribution): void {
  const marker = key(scope, "approve", refundId); if (store.getItem(marker) !== null) throw new Error("contribution_approval_already_submitted");
  store.setItem(marker, JSON.stringify(value)); const saved = pendingContributionApproval(store, scope, refundId);
  if (!saved || saved.id !== value.id || saved.grossCents !== value.grossCents) throw new Error("contribution_storage_unavailable");
}
/** Clear only after a matching durable terminal journal, enabling another
 * human-approved contribution when a credited net amount is insufficient. */
export function clearTerminalContributionApproval(store: ContributionStorage, scope: ContributionScope, refundId: string, id: string, status: string): void {
  if (status !== "credited" && status !== "expired") return;
  const old = pendingContributionApproval(store, scope, refundId); if (old?.id === id) store.removeItem(key(scope, "approve", refundId));
}
export function parseContributionAmount(value: string): number | null {
  if (!/^\d{1,8}(?:[.,]\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 2_147_483_647 ? cents : null;
}
