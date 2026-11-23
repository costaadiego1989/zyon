import assert from "node:assert/strict";
import test from "node:test";
import { operationalServiceTurn, serviceOperationalTools, presentServiceBookingResult } from "./service-booking-routing.js";
import { storefrontIntentOutputSchema } from "../../domain/contracts/storefront-intent.schemas.js";
import { buildStoreTools } from "../../domain/tools/index.js";
import { storefrontIntentPromptV1 } from "../../domain/prompts/storefront-intent.v1.js";

const classification = { schemaVersion: 2 as const, domain: "STORE_COMMERCE" as const, intent: "COMPLEX_QUESTION" as const,
  confidence: 0.99, requiresTool: true, needsProductDiscovery: false, shoppingPhase: null, serviceRequest: "live_facts" as const };
test("T43 operational routing boundary", async t => {
  await t.test("provider examples distinguish browsing and selection from educational context without granting booking authority", () => {
    const examples = storefrontIntentPromptV1.examples.filter(example => example.output.serviceAction != null);
    assert.deepEqual(examples.map(example => example.output.serviceAction), ["browse", "select"]);
    for (const example of examples) {
      const hint = storefrontIntentOutputSchema.parse(example.output);
      assert.equal(hint.domain, "STORE_COMMERCE"); assert.equal(hint.intent, "COMPLEX_QUESTION");
      assert.equal(hint.requiresTool, true); assert.equal(hint.needsProductDiscovery, false);
      assert.equal(operationalServiceTurn(hint, undefined), false);
      assert.equal(operationalServiceTurn(hint, {} as never), true);
    }
  });
  await t.test("historical V2 classifications remain accepted and cannot enter the new branch implicitly", () => {
    const historical = storefrontIntentOutputSchema.parse(classification);
    assert.equal(operationalServiceTurn(historical, {} as never), false);
  });
  await t.test("an operational semantic hint needs the private service handler binding", () => {
    const hint = { ...classification, serviceAction: "select" as const };
    assert.equal(operationalServiceTurn(hint, undefined), false);
    assert.equal(operationalServiceTurn(hint, {} as never), true);
    assert.equal(operationalServiceTurn({ ...hint, domain: "OUT_OF_SCOPE" }, {} as never), false);
    assert.equal(operationalServiceTurn({ ...hint, serviceRequest: "professional_decision" }, {} as never), false);
  });
  await t.test("educational and professional-decision questions retain their existing governed RAG path", () => {
    for (const serviceRequest of ["informational", "live_facts", "professional_decision"] as const)
      assert.equal(operationalServiceTurn({ ...classification, serviceRequest, serviceAction: null }, {} as never), false);
  });
  await t.test("the operational allowlist contains only canonical service tools and catalog lookup reads", () => {
    const names = [...buildStoreTools(), ...["get_service_professionals", "get_service_dates", "get_service_slots", "resolve_service_selection"].map(name => ({ name }))];
    const selected = serviceOperationalTools(names).map(value => value.name);
    assert.deepEqual(selected.sort(), ["search_products", "get_product_details", "list_categories", "get_service_professionals", "get_service_dates", "get_service_slots", "resolve_service_selection"].sort());
    for (const forbidden of ["add_item_to_cart", "create_checkout_session", "quote_shipping", "get_product_availability", "prepare_service_booking", "confirm_service_booking"])
      assert.equal(selected.includes(forbidden), false);
  });
  await t.test("new semantic output cannot turn a product discovery or support classification into operational authority", () => {
    assert.equal(storefrontIntentOutputSchema.safeParse({ ...classification, serviceAction: "browse" }).success, true);
    for (const patch of [{ needsProductDiscovery: true }, { requiresTool: false }, { domain: "STORE_SUPPORT" }, { intent: "ADD_CART" }])
      assert.equal(storefrontIntentOutputSchema.safeParse({ ...classification, serviceAction: "select", ...patch }).success, false);
  });
  await t.test("typed authentication result produces a concrete UI action without model narration", () => {
    const result = presentServiceBookingResult({ ok: true, data: { kind: "authentication_required", action: "authenticate" } });
    assert.equal(result.data?.kind, "authentication_required"); assert.equal((result.data as any).action, "authenticate");
    assert.equal(result.message, "Entre na sua conta para consultar os horários e continuar o agendamento.");
  });
  await t.test("failed or unknown tool output produces no actionable or confirmed booking block", () => {
    const result = presentServiceBookingResult({ ok: false, error: "service_booking_unconfirmed" });
    assert.equal(result.data, undefined); assert.equal(result.message.includes("não consegui confirmar"), true);
    assert.equal(presentServiceBookingResult({ ok: true, data: { kind: "paid", token: "private" } }).data, undefined);
  });
});
