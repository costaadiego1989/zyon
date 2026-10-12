import { describe, expect, it } from "vitest";
import { clearTerminalSellerFeeApproval, pendingSellerFeeApproval, rememberSellerFeeApproval, rememberSellerFeeSubmission,
  sellerFeeSubmissionExists, parseSellerFeeAmount, type SellerFeeStorage, type PendingSellerFee } from "./seller-fee-command-state.js";
const scope = { merchantId: "seller_aurora", userId: "owner_aurora" };
const p: PendingSellerFee = { id: "mcfee_aurora", grossCents: 300, feeCertificateId: "fee_aurora", environment: "test" };
const receipt = { collection_id: p.id, gross_amount_cents: p.grossCents, fee_certificate_id: p.feeCertificateId, environment: p.environment, status: "credited" };
function storage() {
  const values = new Map<string, string>();
  const store: SellerFeeStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => { values.set(k, v); }, removeItem: k => { values.delete(k); } };
  return { store, values };
}
describe("seller fee durable financial browser state", () => {
  it("preserves first approval ID, scope, certificate, environment and gross before POST", () => {
    const { store } = storage(); rememberSellerFeeApproval(store, scope, "debt_aurora", p);
    expect(pendingSellerFeeApproval(store, scope, "debt_aurora")).toEqual(p);
    expect(() => rememberSellerFeeApproval(store, scope, "debt_aurora", { ...p, id: "mcfee_other" })).toThrow("already_submitted");
  });
  it("reload sees the submitted marker and cannot authorize a second execute", () => {
    const { store } = storage(); rememberSellerFeeSubmission(store, scope, p.id);
    expect(sellerFeeSubmissionExists(store, scope, p.id)).toBe(true);
    expect(() => rememberSellerFeeSubmission(store, scope, p.id)).toThrow("already_sent");
  });
  it("a first excess marker survives reload and another workspace cannot submit it again", () => {
    const { store, values } = storage();
    rememberSellerFeeSubmission(store, scope, p.id, "excess");
    expect(sellerFeeSubmissionExists(store, { ...scope }, p.id, "excess")).toBe(true);
    expect(() => rememberSellerFeeSubmission(store, { ...scope }, p.id, "excess")).toThrow("already_sent");
    expect(values.size).toBe(1); expect(sellerFeeSubmissionExists(store, scope, p.id)).toBe(false);
    rememberSellerFeeSubmission(store, scope, p.id); expect(values.size).toBe(2);
    clearTerminalSellerFeeApproval(store, scope, "debt_aurora", receipt);
    expect(sellerFeeSubmissionExists(store, scope, p.id, "excess")).toBe(true);
  });
  it("isolates excess return markers by family, merchant, principal and collection", () => {
    const { store } = storage(); rememberSellerFeeSubmission(store, scope, p.id, "excess");
    for (const other of [{ ...scope, family: "host" as const }, { ...scope, merchantId: "other" }, { ...scope, userId: "other" }])
      expect(sellerFeeSubmissionExists(store, other, p.id, "excess")).toBe(false);
    expect(sellerFeeSubmissionExists(store, scope, "another_collection", "excess")).toBe(false);
  });
  it("dropped excess marker writes and any existing marker block another financial submission", () => {
    const dropped: SellerFeeStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    expect(() => rememberSellerFeeSubmission(dropped, scope, p.id, "excess")).toThrow("storage_unavailable");
    const interrupted: SellerFeeStorage = { ...dropped, getItem: () => "future_or_interrupted" };
    expect(sellerFeeSubmissionExists(interrupted, scope, p.id, "excess")).toBe(true);
    expect(() => rememberSellerFeeSubmission(interrupted, scope, p.id, "excess")).toThrow("already_sent");
  });
  it("keeps approval after every nonterminal result including paid without credited state", () => {
    const { store } = storage(); rememberSellerFeeApproval(store, scope, "debt_aurora", p);
    for (const status of ["approved", "creating", "open", "paid", "unproven", "404"])
      clearTerminalSellerFeeApproval(store, scope, "debt_aurora", { ...receipt, status });
    expect(pendingSellerFeeApproval(store, scope, "debt_aurora")).toEqual(p);
  });
  it("requires the matching frozen identity and amounts before clearing terminal approval", () => {
    const { store } = storage(); rememberSellerFeeApproval(store, scope, "debt_aurora", p);
    for (const k of ["collection_id", "gross_amount_cents", "fee_certificate_id", "environment"] as const)
      clearTerminalSellerFeeApproval(store, scope, "debt_aurora", { ...receipt, [k]: k === "gross_amount_cents" ? 999 : "foreign" });
    expect(pendingSellerFeeApproval(store, scope, "debt_aurora")).toEqual(p);
  });
  it("allows a fresh human consent after matching terminal credit without clearing old execute marker", () => {
    const { store } = storage(); rememberSellerFeeApproval(store, scope, "debt_aurora", p); rememberSellerFeeSubmission(store, scope, p.id);
    clearTerminalSellerFeeApproval(store, scope, "debt_aurora", receipt); expect(pendingSellerFeeApproval(store, scope, "debt_aurora")).toBeNull();
    expect(sellerFeeSubmissionExists(store, scope, p.id)).toBe(true);
    rememberSellerFeeApproval(store, scope, "debt_aurora", { ...p, id: "mcfee_second", grossCents: 130 });
    expect(pendingSellerFeeApproval(store, scope, "debt_aurora")?.id).toBe("mcfee_second");
  });
  it("clears only the matching expired approval and preserves prior submission uncertainty", () => {
    const { store } = storage(); rememberSellerFeeApproval(store, scope, "debt_aurora", p); rememberSellerFeeSubmission(store, scope, p.id);
    clearTerminalSellerFeeApproval(store, scope, "debt_aurora", { ...receipt, status: "expired" });
    expect(pendingSellerFeeApproval(store, scope, "debt_aurora")).toBeNull(); expect(sellerFeeSubmissionExists(store, scope, p.id)).toBe(true);
  });
  it("separates merchant, owner, debt and financial purpose from refund contribution markers", () => {
    const { store, values } = storage(); rememberSellerFeeApproval(store, scope, "debt_aurora", p); rememberSellerFeeSubmission(store, scope, p.id);
    expect(pendingSellerFeeApproval(store, { ...scope, merchantId: "seller_other" }, "debt_aurora")).toBeNull();
    expect(pendingSellerFeeApproval(store, { ...scope, userId: "owner_other" }, "debt_aurora")).toBeNull();
    expect(pendingSellerFeeApproval(store, scope, "debt_other")).toBeNull();
    expect([...values.keys()].every(k => k.startsWith("zyon:seller-fee-collection:v1:"))).toBe(true);
  });
  it("silently dropped writes block financial submission", () => {
    const store: SellerFeeStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
    expect(() => rememberSellerFeeApproval(store, scope, "debt_aurora", p)).toThrow("storage_unavailable");
    expect(() => rememberSellerFeeSubmission(store, scope, p.id)).toThrow("storage_unavailable");
  });
  it("corrupt approval or unavailable storage fails closed rather than permitting a new POST", () => {
    for (const raw of ["{", JSON.stringify({ ...p, id: "foreign/path" }), JSON.stringify({ ...p, grossCents: -1 }),
      JSON.stringify({ ...p, environment: "unknown" }), JSON.stringify({ ...p, customerId: "cus_foreign" })]) {
      const store: SellerFeeStorage = { getItem: () => raw, setItem: () => {}, removeItem: () => {} };
      expect(() => pendingSellerFeeApproval(store, scope, "debt_aurora")).toThrow("storage_invalid");
    }
    const store: SellerFeeStorage = { getItem: () => { throw Error("disabled"); }, setItem: () => {}, removeItem: () => {} };
    expect(() => pendingSellerFeeApproval(store, scope, "debt_aurora")).toThrow("disabled");
  });
  it("any submitted marker including corrupt future marker blocks execute after reload", () => {
    const store: SellerFeeStorage = { getItem: () => "corrupt", setItem: () => {}, removeItem: () => {} };
    expect(sellerFeeSubmissionExists(store, scope, p.id)).toBe(true);
    expect(() => rememberSellerFeeSubmission(store, scope, p.id)).toThrow("already_sent");
  });
  it("validates pending values before writing to durable storage", () => {
    const { store, values } = storage();
    expect(() => rememberSellerFeeApproval(store, scope, "debt_aurora", { ...p, grossCents: 300.1 })).toThrow("storage_invalid");
    expect(values.size).toBe(0);
  });
  it("converts Brazilian decimals exactly, allowing explicit partial consent without rounding", () => {
    expect(parseSellerFeeAmount("1,30")).toBe(130); expect(parseSellerFeeAmount("1.3")).toBe(130); expect(parseSellerFeeAmount("270")).toBe(27000);
    expect(parseSellerFeeAmount("21474836,47")).toBe(2147483647);
    for (const bad of ["1,001", "-1", "1e3", "1.000,00", "0", "NaN", "Infinity", "21474836,48"])
      expect(parseSellerFeeAmount(bad)).toBeNull();
  });
});

describe("host fee consent has an independent durable financial purpose", () => {
  const hostScope = { ...scope, family: "host" as const };
  it("separates host and seller markers even for identical merchant, user, debt and collection IDs", () => {
    const { store, values } = storage(); rememberSellerFeeApproval(store, scope, "same_payout", p);
    expect(pendingSellerFeeApproval(store, hostScope, "same_payout")).toBeNull();
    rememberSellerFeeApproval(store, hostScope, "same_payout", p); rememberSellerFeeSubmission(store, hostScope, p.id);
    expect(sellerFeeSubmissionExists(store, scope, p.id)).toBe(false);
    expect([...values.keys()].some(k => k.startsWith("zyon:host-fee-collection:v1:"))).toBe(true);
    clearTerminalSellerFeeApproval(store, hostScope, "same_payout", receipt);
    expect(pendingSellerFeeApproval(store, scope, "same_payout")).toEqual(p);
    expect(sellerFeeSubmissionExists(store, hostScope, p.id)).toBe(true);
  });
  it("host reload preserves the first approval and consumed submission across tenant/user switches", () => {
    const { store } = storage(); rememberSellerFeeApproval(store, hostScope, "payout_host", p); rememberSellerFeeSubmission(store, hostScope, p.id);
    expect(pendingSellerFeeApproval(store, { ...hostScope }, "payout_host")).toEqual(p);
    expect(() => rememberSellerFeeSubmission(store, hostScope, p.id)).toThrow("already_sent");
    expect(pendingSellerFeeApproval(store, { ...hostScope, merchantId: "foreign" }, "payout_host")).toBeNull();
    expect(pendingSellerFeeApproval(store, { ...hostScope, userId: "another_admin" }, "payout_host")).toBeNull();
  });
  it("host gross below the provider minimum fails before persistence and does not change seller minimum", () => {
    const { store, values } = storage();
    for (const grossCents of [1, 30, 49]) expect(() => rememberSellerFeeApproval(store, hostScope, "payout_host", { ...p, grossCents })).toThrow("storage_invalid");
    expect(values.size).toBe(0); rememberSellerFeeApproval(store, hostScope, "payout_host", { ...p, grossCents: 50 });
    rememberSellerFeeApproval(store, scope, "seller_debt", { ...p, grossCents: 1 });
    expect(pendingSellerFeeApproval(store, scope, "seller_debt")?.grossCents).toBe(1);
  });
  it("unknown financial families fail closed instead of sharing another operation's storage", () => {
    const { store, values } = storage();
    expect(() => rememberSellerFeeApproval(store, { ...scope, family: "refund" } as any, "payout_host", p)).toThrow("invalid_scope");
    expect(values.size).toBe(0);
  });
});
