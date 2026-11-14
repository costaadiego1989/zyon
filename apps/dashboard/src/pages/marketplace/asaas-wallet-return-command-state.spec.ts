import { expect, it } from "vitest";
import { rememberWalletReturnSubmission, walletReturnSubmissionExists, type WalletReturnStorage } from "./asaas-wallet-return-command-state.js";
function fixture() {
  const values = new Map<string, string>();
  const storage: WalletReturnStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  return { values, storage };
}
const scope = { merchantId: "seller_one", userId: "owner_one" };
it("persists the GET-only marker across new workspace instances and stale claimed responses", () => {
  const f = fixture(); rememberWalletReturnSubmission(f.storage, scope, "journal_one");
  expect(walletReturnSubmissionExists(f.storage, { ...scope }, "journal_one")).toBe(true);
  expect(walletReturnSubmissionExists(f.storage, scope, "journal_two")).toBe(false);
});
it("merchant and principal switches cannot inherit another seller's submission state", () => {
  const f = fixture(); rememberWalletReturnSubmission(f.storage, scope, "journal_one");
  expect(walletReturnSubmissionExists(f.storage, { ...scope, merchantId: "seller_two" }, "journal_one")).toBe(false);
  expect(walletReturnSubmissionExists(f.storage, { ...scope, userId: "owner_two" }, "journal_one")).toBe(false);
});
it("failed persistent writes stop the financial command before transport", () => {
  const storage: WalletReturnStorage = { setItem: () => { throw Error("disabled_storage"); }, getItem: () => null };
  expect(() => rememberWalletReturnSubmission(storage, scope, "journal_one")).toThrow("disabled_storage");
});
it("a silently discarded write is not accepted as durable recovery state", () => {
  expect(() => rememberWalletReturnSubmission({ setItem: () => {}, getItem: () => null }, scope, "journal_one")).toThrow("wallet_return_submission_storage_unavailable");
});
