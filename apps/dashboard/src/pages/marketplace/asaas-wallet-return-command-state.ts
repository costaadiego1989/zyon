export type WalletReturnScope = { merchantId: string; userId: string };
export type WalletReturnStorage = Pick<Storage, "getItem" | "setItem">;
const key = (scope: WalletReturnScope, journalId: string) => `zyon:asaas-wallet-return:v1:${encodeURIComponent(scope.merchantId)}:${encodeURIComponent(scope.userId)}:${encodeURIComponent(journalId)}`;

/** Marker is written before the command. It deliberately never expires or
 * clears after a stale claimed GET; restart cannot authorize a POST replay. */
export function rememberWalletReturnSubmission(storage: WalletReturnStorage, scope: WalletReturnScope, journalId: string): void {
  const marker = key(scope, journalId);
  storage.setItem(marker, "submitted");
  if (storage.getItem(marker) !== "submitted") throw new Error("wallet_return_submission_storage_unavailable");
}
export function walletReturnSubmissionExists(storage: WalletReturnStorage, scope: WalletReturnScope, journalId: string): boolean {
  return storage.getItem(key(scope, journalId)) !== null;
}
