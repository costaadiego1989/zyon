import { describe, expect, it } from "vitest";
import { marketplaceHostFeeCollectionEndpoints } from "./marketplace-host-fee-collections.js";

const certificate = `mhost_extinction_${"a".repeat(64)}`, obligation = `mhost_obligation_${"b".repeat(64)}`;
const candidate = { kind: "candidate", debt_id: "payout_host", fee_certificate_id: certificate, environment: "test",
  due_cents: 30, collected_cents: 0, outstanding_cents: 30, processing_fee_cents: 0, excess_liability_cents: 0,
  can_prepare: true, customer_setup_required: false, obligation_status: "outstanding", obligation_can_close: false,
  funding_hold_released: false, payout_reauthorized: false };
const approved = { collection_id: "mhostfee_first", debt_id: "payout_host", fee_certificate_id: certificate, environment: "test", status: "approved",
  gross_amount_cents: 60, maximum_credit_cents: 30, credited_net_cents: 0, processing_fee_cents: 0, processing_fee_known: false,
  excess_liability_cents: 0, request_hash: "c".repeat(64), can_execute: true, can_cancel: true, currency: "BRL",
  funding_hold_released: false, payout_reauthorized: false };
function fixture(value: unknown, status = 200) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const transport: typeof fetch = async (input, init) => { calls.push({ url: String(input), init });
    return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }); };
  return { calls, api: marketplaceHostFeeCollectionEndpoints("https://api.example.test", transport) };
}

describe("host fee public client shares validation while isolating financial purpose", () => {
  it("discovers small original host debts and strips account/customer/native proof fields", async () => {
    const f = fixture({ items: [{ ...candidate, customer_id: "cus_private", account_fingerprint: "PRIVATE", proof: {} }], next_cursor: "page_two" });
    const page = await f.api.candidatesMarketplaceHostFeeCollections(); expect(page.items).toEqual([candidate]);
    expect(f.calls[0].url).toContain("/marketplace/dashboard/host-fee-collections/candidates?limit=20");
    expect(f.calls[0].init?.method).toBe("GET"); expect(JSON.stringify(page)).not.toMatch(/PRIVATE|cus_private|proof/);
  });
  it("hosted preparation carries only original payout ID, unique collection, exact gross and human consent", async () => {
    const f = fixture(approved); await f.api.prepareMarketplaceHostFeeCollection("payout_host", "mhostfee_first", 60);
    expect(f.calls).toHaveLength(1); expect(f.calls[0].url).toMatch(/host-fee-collections\/hosted$/);
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ debt_id: "payout_host", collection_id: "mhostfee_first", gross_amount_cents: 60, confirmed: true });
  });
  it("gross below 50 cents is rejected before any prepare or execute transport", async () => {
    const f = fixture(approved);
    for (const gross of [1, 30, 49]) {
      await expect(f.api.prepareMarketplaceHostFeeCollection("payout_host", "mhostfee_first", gross)).rejects.toThrow("amount");
      await expect(f.api.executeMarketplaceHostFeeCollection("mhostfee_first", gross)).rejects.toThrow("amount");
    }
    expect(f.calls).toHaveLength(0);
  });
  it("unknown financial commands never refresh authentication or repeat a POST", async () => {
    for (const status of [401, 409, 500]) {
      const f = fixture({}, status); await expect(f.api.executeMarketplaceHostFeeCollection("mhostfee_first", 60)).rejects.toThrow();
      expect(f.calls).toHaveLength(1); expect(f.calls[0].init?.method).toBe("POST"); expect(f.calls[0].init?.redirect).toBe("error");
    }
    let calls = 0; const transport: typeof fetch = async () => { calls++; throw Error("lost_response"); };
    await expect(marketplaceHostFeeCollectionEndpoints("https://api.example.test", transport).executeMarketplaceHostFeeCollection("mhostfee_first", 60)).rejects.toThrow();
    expect(calls).toBe(1);
  });
  it("uses the native net credit and conserves processing and held excess independently", async () => {
    const credited = { ...approved, status: "credited", can_execute: false, can_cancel: false, processing_fee_known: true,
      processing_fee_cents: 20, credited_net_cents: 30, excess_liability_cents: 10, excess_status: "held" };
    const f = fixture(credited); expect((await f.api.getMarketplaceHostFeeCollection("mhostfee_first")).excess_status).toBe("held");
    await expect(fixture({ ...credited, credited_net_cents: 40 }).api.getMarketplaceHostFeeCollection("mhostfee_first")).rejects.toThrow();
    await expect(fixture({ ...approved, status: "paid", can_execute: false, can_cancel: false, credited_net_cents: 30 }).api.getMarketplaceHostFeeCollection("mhostfee_first")).rejects.toThrow();
  });
  it("seller-purpose certificates and malformed host gross cannot enter host state", async () => {
    await expect(fixture({ ...candidate, fee_certificate_id: `mdebt_extinction_${"a".repeat(64)}` }).api.contextMarketplaceHostFeeCollection("payout_host")).rejects.toThrow();
    await expect(fixture({ ...approved, gross_amount_cents: 49 }).api.getMarketplaceHostFeeCollection("mhostfee_first")).rejects.toThrow();
    await expect(fixture({ ...approved, collection_id: "foreign" }).api.getMarketplaceHostFeeCollection("mhostfee_first")).rejects.toThrow();
  });
  it("terminal host receipt binds the original payout and keeps funding/payout holds", async () => {
    const receipt = { status: "closed", obligationId: obligation, debtId: "payout_host", replay: true, fundingHoldReleased: false, payoutReauthorized: false };
    const f = fixture(receipt); expect(await f.api.closeMarketplaceHostFeeObligation("payout_host")).toEqual(receipt);
    expect(f.calls[0].url).toContain("host-fee-collections/obligations/payout_host/close");
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ confirmed: true });
    for (const bad of [{ ...receipt, debtId: "foreign" }, { ...receipt, obligationId: "seller_obligation" }, { ...receipt, fundingHoldReleased: true }])
      await expect(fixture(bad).api.closeMarketplaceHostFeeObligation("payout_host")).rejects.toThrow();
  });
  it("returns certified host excess through the host purpose with exact consent and no payout release", async () => {
    const returned = { ...approved, status: "credited", gross_amount_cents: 80, can_execute: false, can_cancel: false,
      processing_fee_known: true, processing_fee_cents: 20, credited_net_cents: 30, excess_liability_cents: 30,
      returned_excess_cents: 30, outstanding_excess_cents: 0, excess_status: "returned", can_return_excess: false };
    const f = fixture(returned);
    expect(await f.api.returnMarketplaceHostFeeExcess(approved.collection_id, 30)).toMatchObject({ excess_liability_cents: 30,
      returned_excess_cents: 30, outstanding_excess_cents: 0, funding_hold_released: false, payout_reauthorized: false });
    expect(f.calls).toHaveLength(1); expect(f.calls[0].url).toMatch(/host-fee-collections\/mhostfee_first\/excess\/return$/);
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ amount_cents: 30, confirmed: true });
  });
  it("rejects unsafe checkout links and permits only native exact-host HTTPS checkout", async () => {
    const opened = { ...approved, status: "open", can_execute: false, can_cancel: false, checkout_url: "https://checkout.stripe.com/c/pay/cs_test_host" };
    expect((await fixture(opened).api.getMarketplaceHostFeeCollection("mhostfee_first")).checkout_url).toBe(opened.checkout_url);
    for (const url of ["javascript:alert(1)", "https://checkout.stripe.com.evil.test/pay/cs_test_host", "https://user@checkout.stripe.com/pay/cs_test_host"])
      await expect(fixture({ ...opened, checkout_url: url }).api.getMarketplaceHostFeeCollection("mhostfee_first")).rejects.toThrow();
  });
});
