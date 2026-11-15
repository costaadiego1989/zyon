import assert from "node:assert/strict";
import test from "node:test";
import { publicProfessionalProfile, resolveProfessionalServiceLink, type ProfessionalServiceFacts } from "./professional-service-link.js";

const facts = (): ProfessionalServiceFacts => ({ merchantId: "tenant", professional: { id: "professional", merchantId: "tenant", isActive: true, isPublished: true, timeZone: "America/Sao_Paulo", version: 3 },
  link: { id: "link", merchantId: "tenant", professionalId: "professional", productId: "service", isActive: true },
  product: { id: "service", merchantId: "tenant", type: "service", isActive: true, deletedAt: null, metadata: { serviceSchedule: { durationMinutes: 30, timeZone: "UTC", slots: [] } }, categoryId: "category" },
  category: { id: "category", merchantId: "tenant", isActive: true }, variant: { id: "variant", productId: "service", isActive: true, price: { basePriceInCents: 15000, currency: "BRL" } } });

test("T20", async t => {
  await t.test("public profile projection copies only typed approved fields and drops private metadata", () => {
    assert.deepEqual(publicProfessionalProfile({ description: "Public biography", specialties: ["Consulting"], privateNotes: "Synthetic secret", customerSnapshot: { name: "Private buyer" }, userId: "private-login" }), { description: "Public biography", specialties: ["Consulting"] });
    for (const invalid of [null, [], "private", { description: { private: "data" }, specialties: ["Valid", { private: "data" }] }]) assert.deepEqual(publicProfessionalProfile(invalid), {});
  });
  await t.test("canonical service supplies duration and variant supplies price while the professional supplies timezone", () => {
    assert.deepEqual(resolveProfessionalServiceLink(facts()), { merchantId: "tenant", professionalId: "professional", professionalVersion: 3, professionalServiceId: "link", productId: "service", variantId: "variant", categoryId: "category", durationMinutes: 30, timeZone: "America/Sao_Paulo", priceInCents: 15000, currency: "BRL" });
  });
  await t.test("foreign professional, link, offer, variant or category cannot produce eligibility", () => {
    for (const key of ["professional", "link", "product", "category"] as const) { const value = facts(); value[key] = { ...value[key]!, merchantId: "foreign" } as never; assert.throws(() => resolveProfessionalServiceLink(value), /not_found/); }
    const value = facts(); value.variant.productId = "foreign"; assert.throws(() => resolveProfessionalServiceLink(value), /not_found/);
  });
  await t.test("unpublished and inactive canonical resources are unavailable", () => {
    for (const key of ["professional", "link", "product", "category", "variant"] as const) { const value = facts(); value[key] = { ...value[key]!, isActive: false } as never; assert.throws(() => resolveProfessionalServiceLink(value), /not_available/); }
    for (const mutation of [(value: ProfessionalServiceFacts) => { value.professional.isPublished = false; }, (value: ProfessionalServiceFacts) => { value.product.type = "physical"; }, (value: ProfessionalServiceFacts) => { value.product.deletedAt = new Date(); }]) { const value = facts(); mutation(value); assert.throws(() => resolveProfessionalServiceLink(value), /not_available/); }
  });
  await t.test("unconfigured duration and price cannot be invented", () => {
    for (const metadata of [null, {}, { serviceSchedule: { durationMinutes: 0, timeZone: "UTC", slots: [] } }]) { const value = facts(); value.product.metadata = metadata; assert.throws(() => resolveProfessionalServiceLink(value), /duration_not_configured/); }
    for (const price of [null, { basePriceInCents: 0, currency: "BRL" }]) { const value = facts(); value.variant.price = price; assert.throws(() => resolveProfessionalServiceLink(value), /price_not_configured/); }
  });
  await t.test("shared category does not become the capacity resource or rewrite price", () => {
    const first = facts(), second = facts(); second.product.id = "service-two"; second.link.productId = second.product.id; second.variant.productId = second.product.id; second.variant.price!.basePriceInCents = 20000;
    assert.equal(resolveProfessionalServiceLink(first).professionalId, resolveProfessionalServiceLink(second).professionalId);
    assert.equal(resolveProfessionalServiceLink(first).priceInCents, 15000); assert.equal(resolveProfessionalServiceLink(second).priceInCents, 20000);
  });
});
