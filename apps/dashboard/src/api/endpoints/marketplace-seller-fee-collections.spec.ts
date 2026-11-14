import { describe, expect, it } from "vitest";
import { marketplaceSellerFeeCollectionEndpoints, marketplaceFeeCollectionEndpoints, assertSameSellerFeeJournal, sellerFeeHostedUrl,
  type SellerFeeCandidate, type SellerFeeJournal } from "./marketplace-seller-fee-collections.js";
import { createSessionFetch } from "../http/session-fetch.js";
const base = "https://seller-fee-dashboard-fixture.invalid";
const c: SellerFeeCandidate = { kind: "candidate", debt_id: "debt_aurora", fee_certificate_id: "fee_aurora", environment: "test", due_cents: 270,
  collected_cents: 0, outstanding_cents: 270, processing_fee_cents: 0, excess_liability_cents: 0, can_prepare: true, customer_setup_required: false,
  obligation_status: "outstanding", obligation_can_close: false, funding_hold_released: false, payout_reauthorized: false };
const approved: SellerFeeJournal = { kind: "journal", collection_id: "mcfee_aurora", debt_id: c.debt_id, fee_certificate_id: c.fee_certificate_id, environment: "test",
  status: "approved", gross_amount_cents: 300, maximum_credit_cents: 270, credited_net_cents: 0, processing_fee_cents: 0, processing_fee_known: false,
  excess_liability_cents: 0, request_hash: "a".repeat(64), can_execute: true, can_cancel: true, currency: "BRL", funding_hold_released: false, payout_reauthorized: false };
const credited: SellerFeeJournal = { ...approved, status: "credited", can_execute: false, can_cancel: false, processing_fee_known: true,
  credited_net_cents: 270, processing_fee_cents: 30 };
function fixture(value: unknown, status = 200, lost = false) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const transport: typeof fetch = async (url, init) => { calls.push({ url: String(url), init }); if (lost) throw Error("lost_response"); return new Response(JSON.stringify(value), { status }); };
  return { calls, api: marketplaceSellerFeeCollectionEndpoints(base, transport), transport };
}
describe("seller fee dashboard financial transport", () => {
  const zero: SellerFeeCandidate = { ...c, fee_certificate_id: `mdebt_extinction_${"a".repeat(64)}`, due_cents: 0,
    outstanding_cents: 0, can_prepare: false, obligation_can_close: true };
  it("accepts certified zero seller allocations without any billing capability or collection", async () => {
    const pending = fixture(zero);
    expect(await pending.api.contextMarketplaceSellerFeeCollection(c.debt_id)).toEqual(zero);
    expect(pending.calls.map(v => v.init?.method)).toEqual(["GET"]);
    const closed = { ...zero, obligation_status: "closed", obligation_can_close: false, obligation_id: `mseller_obligation_${"b".repeat(64)}` };
    expect((await fixture({ items: [closed] }).api.candidatesMarketplaceSellerFeeCollections()).items).toEqual([closed]);
  });
  it("rejects zero allocations carrying charges, processing, excess, customer setup or uncertified identities", async () => {
    for (const bad of [{ ...zero, can_prepare: true }, { ...zero, customer_setup_required: true }, { ...zero, processing_fee_cents: 1 },
      { ...zero, excess_liability_cents: 1 }, { ...zero, collected_cents: 1 }, { ...zero, fee_certificate_id: "unproven" },
      { ...zero, obligation_status: "closed", obligation_can_close: false, obligation_id: "unproven" }])
      await expect(fixture(bad).api.contextMarketplaceSellerFeeCollection(c.debt_id)).rejects.toThrow();
    const f = fixture(zero);
    await expect(f.api.prepareMarketplaceSellerFeeCollection(c.debt_id, "mcfee_zero", 0)).rejects.toThrow();
    await expect(f.api.executeMarketplaceSellerFeeCollection("mcfee_zero", 0)).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
  it("keeps zero host fee allocations outside hosted host collections", async () => {
    const f = fixture(zero), api = marketplaceFeeCollectionEndpoints(base, f.transport, "host");
    await expect(api.contextMarketplaceSellerFeeCollection(c.debt_id)).rejects.toThrow();
  });
  for (const family of ["seller", "host"] as const) it(`${family} prepare and execute reject subminimum amounts before transport and allow 50 cents`, async () => {
    const receipt = { ...approved, gross_amount_cents: 50,
      fee_certificate_id: family === "host" ? `mhost_extinction_${"a".repeat(64)}` : approved.fee_certificate_id };
    const f = fixture(receipt), api = marketplaceFeeCollectionEndpoints(base, f.transport, family);
    for (const gross of [31, 49]) {
      await expect(api.prepareMarketplaceSellerFeeCollection(c.debt_id, approved.collection_id, gross)).rejects.toThrow("invalid_marketplace_seller_fee_amount");
      await expect(api.executeMarketplaceSellerFeeCollection(approved.collection_id, gross)).rejects.toThrow("invalid_marketplace_seller_fee_amount");
    }
    expect(f.calls).toHaveLength(0);
    expect(await api.prepareMarketplaceSellerFeeCollection(c.debt_id, approved.collection_id, 50)).toEqual(receipt);
    expect(await api.executeMarketplaceSellerFeeCollection(approved.collection_id, 50)).toEqual(receipt);
    expect(f.calls.map(value => value.url)).toEqual([`${base}/v1/marketplace/dashboard/${family}-fee-collections/hosted`,
      `${base}/v1/marketplace/dashboard/${family}-fee-collections/${approved.collection_id}/execute`]);
    expect(f.calls.map(value => JSON.parse(String(value.init?.body)))).toEqual([
      { debt_id: c.debt_id, collection_id: approved.collection_id, gross_amount_cents: 50, confirmed: true },
      { gross_amount_cents: 50, confirmed: true },
    ]);
  });
  it("reads and cancels a legacy 31-cent seller approval without execution capability", async () => {
    const legacy = { ...approved, gross_amount_cents: 31, maximum_credit_cents: 31, can_execute: false };
    const lookup = fixture(legacy), history = fixture({ items: [legacy] });
    expect(await lookup.api.getMarketplaceSellerFeeCollection(legacy.collection_id)).toEqual(legacy);
    expect((await history.api.listMarketplaceSellerFeeCollections(c.debt_id)).items).toEqual([legacy]);
    expect([...lookup.calls, ...history.calls].every(value => value.init?.method === "GET")).toBe(true);
    const expired = { ...legacy, status: "expired", can_cancel: false }, canceled = fixture(expired);
    expect(await canceled.api.cancelMarketplaceSellerFeeCollection(legacy.collection_id)).toEqual(expired);
    expect(canceled.calls).toHaveLength(1);
    expect(canceled.calls[0].url).toBe(`${base}/v1/marketplace/dashboard/seller-fee-collections/${legacy.collection_id}/cancel`);
    expect(JSON.parse(String(canceled.calls[0].init?.body))).toEqual({ confirmed: true });
  });
  it("keeps paid and credited 31-cent seller journals readable with conserved certified net", async () => {
    for (const status of ["paid", "credited"] as const) {
      const legacy = { ...credited, status, gross_amount_cents: 31, maximum_credit_cents: 31, credited_net_cents: 30, processing_fee_cents: 1 };
      const f = fixture(legacy);
      expect(await f.api.getMarketplaceSellerFeeCollection(legacy.collection_id)).toEqual(legacy);
      expect(f.calls.map(value => value.init?.method)).toEqual(["GET"]);
    }
  });
  it("rejects journal capabilities inconsistent with the Checkout minimum or approval status", async () => {
    const legacy = { ...approved, gross_amount_cents: 31, maximum_credit_cents: 31, can_execute: false };
    for (const bad of [{ ...legacy, can_execute: true }, { ...legacy, can_cancel: false },
      { ...approved, can_execute: undefined }, { ...legacy, status: "paid", can_cancel: true }])
      await expect(fixture(bad).api.getMarketplaceSellerFeeCollection(approved.collection_id)).rejects.toThrow("invalid_marketplace_seller_fee_receipt");
  });
  for (const family of ["seller", "host"] as const) it(`${family} historical approvals remain readable when policy disables execution`, async () => {
    const receipt = { ...approved, can_execute: false,
      fee_certificate_id: family === "host" ? `mhost_extinction_${"a".repeat(64)}` : approved.fee_certificate_id };
    const f = fixture(receipt), api = marketplaceFeeCollectionEndpoints(base, f.transport, family);
    expect(await api.getMarketplaceSellerFeeCollection(receipt.collection_id)).toEqual(receipt);
    expect(f.calls.map(value => value.init?.method)).toEqual(["GET"]);
    await expect(marketplaceFeeCollectionEndpoints(base, fixture({ ...receipt, can_execute: true, status: "paid", can_cancel: false }).transport, family)
      .getMarketplaceSellerFeeCollection(receipt.collection_id)).rejects.toThrow("invalid_marketplace_seller_fee_receipt");
  });
  it("discovers candidates through a bounded GET without returning provider/customer payload", async () => {
    const f = fixture({ items: [{ ...c, secret_customer: "PRIVATE" }], next_cursor: "next_cursor" });
    const result = await f.api.candidatesMarketplaceSellerFeeCollections("previous_cursor");
    expect(result.items).toEqual([c]); expect(f.calls[0].url).toContain("/candidates?limit=20&cursor=previous_cursor");
    expect(f.calls[0].init?.method).toBe("GET");
  });
  it("context, debt history and return lookup only perform GET", async () => {
    const ctx = fixture(c); await ctx.api.contextMarketplaceSellerFeeCollection(c.debt_id);
    const list = fixture({ items: [approved], next_cursor: "page_two" }); await list.api.listMarketplaceSellerFeeCollections(c.debt_id, "prior");
    const f = fixture(approved); await f.api.getMarketplaceSellerFeeCollection(approved.collection_id);
    expect(list.calls[0].url).toContain("?debt_id=debt_aurora&limit=20&cursor=prior");
    expect([...ctx.calls, ...list.calls, ...f.calls].every(v => v.init?.method === "GET")).toBe(true);
  });
  it("hosted approval has only consent, debt, generated collection identity and gross amount", async () => {
    const f = fixture(approved); await f.api.prepareMarketplaceSellerFeeCollection(c.debt_id, approved.collection_id, 300);
    expect(f.calls[0].url).toMatch(/\/hosted$/);
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ debt_id: c.debt_id, collection_id: approved.collection_id, gross_amount_cents: 300, confirmed: true });
  });
  it("keeps execute and recovery as distinct explicit commands with no generic replay", async () => {
    const f = fixture({ ...approved, status: "creating", can_execute: false, can_cancel: false });
    await f.api.executeMarketplaceSellerFeeCollection(approved.collection_id, 300); await f.api.reconcileMarketplaceSellerFeeCollection(approved.collection_id);
    expect(f.calls.map(v => JSON.parse(String(v.init?.body)))).toEqual([{ gross_amount_cents: 300, confirmed: true }, { confirmed: true }]);
    expect(f.calls.every(v => v.init?.credentials === "include" && v.init?.redirect === "error" && !!v.init?.signal)).toBe(true);
  });
  it("cancellation requires an expired terminal journal", async () => {
    const f = fixture({ ...approved, status: "expired", can_execute: false, can_cancel: false });
    expect((await f.api.cancelMarketplaceSellerFeeCollection(approved.collection_id)).status).toBe("expired");
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ confirmed: true });
    await expect(fixture(approved).api.cancelMarketplaceSellerFeeCollection(approved.collection_id)).rejects.toThrow("invalid_marketplace_seller_fee_receipt");
  });
  it("quits only the matching individual obligation and never accepts hold or payout release", async () => {
    const receipt = { status: "closed", obligationId: "obligation_aurora", debtId: c.debt_id, replay: false, fundingHoldReleased: false, payoutReauthorized: false };
    const f = fixture(receipt); expect(await f.api.closeMarketplaceSellerFeeObligation(c.debt_id)).toEqual(receipt);
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ confirmed: true });
    for (const bad of [{ ...receipt, debtId: "foreign" }, { ...receipt, fundingHoldReleased: true }, { ...receipt, payoutReauthorized: true }])
      await expect(fixture(bad).api.closeMarketplaceSellerFeeObligation(c.debt_id)).rejects.toThrow();
  });
  for (const status of [400, 401, 409, 500]) it(`financial command ${status} never refreshes or repeats`, async () => {
    const f = fixture({ provider_secret: "PRIVATE" }, status);
    await expect(f.api.executeMarketplaceSellerFeeCollection(approved.collection_id, 300)).rejects.toThrow(`dashboard_http_${status}`);
    expect(f.calls).toHaveLength(1);
  });
  it("lost execute response makes exactly one transport call", async () => {
    const f = fixture({}, 200, true); await expect(f.api.executeMarketplaceSellerFeeCollection(approved.collection_id, 300)).rejects.toThrow("lost_response");
    expect(f.calls).toHaveLength(1);
  });
  it("uses the existing returned bearer session", async () => {
    const calls: RequestInit[] = [];
    const transport: typeof fetch = async (url, init) => { calls.push(init!); return new Response(JSON.stringify(String(url).endsWith("/auth/login") ? { access_token: "synthetic_fixture" } : approved)); };
    await createSessionFetch(base, transport)(`${base}/v1/auth/login`, { method: "POST" });
    await marketplaceSellerFeeCollectionEndpoints(base, transport).executeMarketplaceSellerFeeCollection(approved.collection_id, 300);
    expect(new Headers(calls[1].headers).get("Authorization")).toBe("Bearer synthetic_fixture"); expect(calls).toHaveLength(2);
  });
  it("accepts native public DTO without kind and removes unrelated financial purposes", async () => {
    const { kind: _kind, ...native } = approved;
    expect(await fixture({ ...native, customer_id: "cus_PRIVATE", raw_provider_proof: { secret: true } }).api.getMarketplaceSellerFeeCollection(approved.collection_id)).toEqual(approved);
    await expect(fixture({ ...native, kind: "candidate", refund_plan_id: "refund_foreign" }).api.getMarketplaceSellerFeeCollection(approved.collection_id)).rejects.toThrow();
  });
  it("accepts available certified net while paid without labeling it a terminal credit", async () => {
    const paid = { ...credited, status: "paid" }; expect((await fixture(paid).api.getMarketplaceSellerFeeCollection(approved.collection_id)).status).toBe("paid");
  });
  it("allows partial net and held excess only with exact amount conservation", async () => {
    const partial = { ...credited, gross_amount_cents: 130, credited_net_cents: 100 };
    expect((await fixture(partial).api.getMarketplaceSellerFeeCollection(approved.collection_id)).credited_net_cents).toBe(100);
    const excess = { ...credited, gross_amount_cents: 400, excess_liability_cents: 100, excess_status: "held" };
    expect((await fixture(excess).api.getMarketplaceSellerFeeCollection(approved.collection_id)).excess_status).toBe("held");
    for (const bad of [{ ...excess, excess_status: undefined }, { ...credited, credited_net_cents: 269 }, { ...partial, credited_net_cents: 270 }, { ...approved, processing_fee_known: true }])
      await expect(fixture(bad).api.getMarketplaceSellerFeeCollection(approved.collection_id)).rejects.toThrow();
  });
  it("keeps the original excess and net fixed while its certified return clears the outstanding liability", async () => {
    const held = { ...credited, gross_amount_cents: 400, excess_liability_cents: 100, excess_status: "held" as const,
      returned_excess_cents: 0, outstanding_excess_cents: 100, can_return_excess: true };
    for (const excess_status of ["unknown", "pending", "failed", "returned"] as const) {
      const receipt = { ...held, excess_status, can_return_excess: false,
        returned_excess_cents: excess_status === "returned" ? 100 : 0, outstanding_excess_cents: excess_status === "returned" ? 0 : 100 };
      expect(await fixture(receipt).api.getMarketplaceSellerFeeCollection(receipt.collection_id)).toEqual(receipt);
      expect(() => assertSameSellerFeeJournal(held, receipt)).not.toThrow();
    }
    for (const bad of [{ ...held, returned_excess_cents: 1 }, { ...held, outstanding_excess_cents: 99 },
      { ...held, excess_status: "pending", can_return_excess: true }, { ...held, excess_status: "returned", can_return_excess: false },
      { ...held, status: "paid" }, { ...held, outstanding_excess_cents: undefined }, { ...held, can_return_excess: undefined }])
      await expect(fixture(bad).api.getMarketplaceSellerFeeCollection(held.collection_id)).rejects.toThrow("invalid_marketplace_seller_fee_receipt");
    expect(() => assertSameSellerFeeJournal(held, { ...held, processing_fee_cents: 31, excess_liability_cents: 99 })).toThrow();
    expect(() => assertSameSellerFeeJournal(held, { ...held, processing_fee_known: false })).toThrow();
  });
  for (const family of ["seller", "host"] as const) it(`${family} excess return sends one exact consent command and recovery remains GET`, async () => {
    const receipt = { ...credited, gross_amount_cents: 400, excess_liability_cents: 100, excess_status: "pending" as const,
      returned_excess_cents: 0, outstanding_excess_cents: 100, can_return_excess: false,
      fee_certificate_id: family === "host" ? `mhost_extinction_${"a".repeat(64)}` : approved.fee_certificate_id };
    const f = fixture(receipt), api = marketplaceFeeCollectionEndpoints(base, f.transport, family);
    expect(await api.returnMarketplaceSellerFeeExcess(receipt.collection_id, 100)).toEqual(receipt);
    expect(f.calls[0].url).toBe(`${base}/v1/marketplace/dashboard/${family}-fee-collections/${receipt.collection_id}/excess/return`);
    expect(JSON.parse(String(f.calls[0].init?.body))).toEqual({ amount_cents: 100, confirmed: true });
    expect(f.calls[0].init?.redirect).toBe("error");
    await api.getMarketplaceSellerFeeCollection(receipt.collection_id);
    expect(f.calls.map(value => value.init?.method)).toEqual(["POST", "GET"]);
    for (const badAmount of [0, -1, 100.1, NaN, 2147483648])
      await expect(api.returnMarketplaceSellerFeeExcess(receipt.collection_id, badAmount)).rejects.toThrow("amount");
    expect(f.calls).toHaveLength(2);
    await expect(api.returnMarketplaceSellerFeeExcess(receipt.collection_id, 99)).rejects.toThrow("invalid_marketplace_seller_fee_receipt");
  });
  it("unknown excess return responses never refresh or replay their POST", async () => {
    for (const status of [401, 409, 500]) {
      const f = fixture({}, status);
      await expect(f.api.returnMarketplaceSellerFeeExcess(credited.collection_id, 100)).rejects.toThrow(`dashboard_http_${status}`);
      expect(f.calls).toHaveLength(1);
    }
    const lost = fixture({}, 200, true);
    await expect(lost.api.returnMarketplaceSellerFeeExcess(credited.collection_id, 100)).rejects.toThrow("lost_response");
    expect(lost.calls).toHaveLength(1);
  });
  it("rejects stale request bindings, unsafe money and foreign receipts", async () => {
    for (const bad of [{ ...approved, collection_id: "foreign" }, { ...approved, gross_amount_cents: 300.1 }, { ...approved, payout_reauthorized: true },
      { ...approved, request_hash: "opaque" }, { ...approved, status: "paid", can_execute: true, can_cancel: false }])
      await expect(fixture(bad).api.getMarketplaceSellerFeeCollection(approved.collection_id)).rejects.toThrow();
    for (const k of ["collection_id", "debt_id", "fee_certificate_id", "environment", "gross_amount_cents", "maximum_credit_cents", "request_hash"] as const)
      expect(() => assertSameSellerFeeJournal(approved, { ...approved, [k]: typeof approved[k] === "number" ? 999 : "foreign" } as SellerFeeJournal)).toThrow();
  });
  it("rejects inconsistent candidate debt, settlement and consent capabilities", async () => {
    for (const bad of [{ ...c, debt_id: "foreign" }, { ...c, collected_cents: 1 }, { ...c, customer_setup_required: true }, { ...c, obligation_can_close: true },
      { ...c, obligation_status: "closed" }, { ...c, funding_hold_released: true }])
      await expect(fixture(bad).api.contextMarketplaceSellerFeeCollection(c.debt_id)).rejects.toThrow();
  });
  it("rejects foreign history, duplicate candidate or journal IDs and oversized pages", async () => {
    await expect(fixture({ items: [{ ...approved, debt_id: "foreign" }] }).api.listMarketplaceSellerFeeCollections(c.debt_id)).rejects.toThrow();
    await expect(fixture({ items: [approved, approved] }).api.listMarketplaceSellerFeeCollections(c.debt_id)).rejects.toThrow();
    await expect(fixture({ items: [c, c] }).api.candidatesMarketplaceSellerFeeCollections()).rejects.toThrow();
    await expect(fixture({ items: Array.from({ length: 21 }, (_, i) => ({ ...c, debt_id: `debt_${i}` })) }).api.candidatesMarketplaceSellerFeeCollections()).rejects.toThrow();
  });
  it("invalid commands and cursors never reach transport", async () => {
    const f = fixture(approved);
    await expect(f.api.prepareMarketplaceSellerFeeCollection(c.debt_id, "foreign/path", 300)).rejects.toThrow();
    await expect(f.api.executeMarketplaceSellerFeeCollection(approved.collection_id, NaN)).rejects.toThrow();
    await expect(f.api.listMarketplaceSellerFeeCollections(c.debt_id, "foreign/path")).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });
  it("exposes a hosted link only for an open journal and exact native payment path", async () => {
    const safe = "https://checkout.stripe.com/c/pay/cs_test_fixture#native";
    expect((await fixture({ ...approved, status: "open", can_execute: false, can_cancel: false, checkout_url: safe }).api.getMarketplaceSellerFeeCollection(approved.collection_id)).checkout_url).toBe(safe);
    await expect(fixture({ ...approved, checkout_url: safe }).api.getMarketplaceSellerFeeCollection(approved.collection_id)).rejects.toThrow();
    for (const unsafe of ["javascript:alert(1)", "http://checkout.stripe.com/c/pay/cs_test_x", "https://checkout.stripe.com.evil.invalid/c/pay/cs_test_x",
      "https://user@checkout.stripe.com/c/pay/cs_test_x", "https://checkout.stripe.com:444/c/pay/cs_test_x", "https://checkout.stripe.com/foreign",
      "https://checkout.stripe.com/c/pay/../cs_test_x", "https://checkout.stripe.com/c/pay/%63s_test_x", " https://checkout.stripe.com/c/pay/cs_test_x"])
      expect(sellerFeeHostedUrl(unsafe)).toBe(false);
  });
});
