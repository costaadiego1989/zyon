import assert from "node:assert/strict";
import test from "node:test";
import { projectPublicBusinessSource, type PublicBusinessSourceInput } from "./public-business-source.js";

const identity = { merchantId: "business-a", sourceId: "source-a", sourceVersion: "canonical-version-4", publicationState: "published" as const };
const canary = "PRIVATE-CANARY-NOT-FOR-RETRIEVAL";

test("T63", async t => {
  await t.test("RAG-01 preserves an already stored public introduction beyond the new-write limit", () => {
    const description = "Apresentação pública legada. ".repeat(50);
    assert.ok(description.length > 1200);
    const source = projectPublicBusinessSource("business-a", { ...identity, sourceType: "company", row: {
      name: "Empresa", storeSettings: { company: { description } },
    } });
    assert.equal(source.publicData.description, description.trim());
    assert.ok(source.text.includes(description.trim()));assert.equal(source.publicationState, "published");
  });
  await t.test("ONB-06 saved service names become public company context only for services", () => {
    const row = { name: "Empresa de serviços", businessMode: "services" as const,
      storeSettings: { company: { description: "Apresentação pública", serviceNames: [" Consulta inicial ", "Acompanhamento"] } } };
    const service = projectPublicBusinessSource("business-a", { ...identity, sourceType: "company", row });
    assert.deepEqual(service.publicData.serviceNames, ["Consulta inicial", "Acompanhamento"]);
    assert.ok(service.text.includes("Consulta inicial"));assert.ok(service.text.includes("Acompanhamento"));
    const product = projectPublicBusinessSource("business-a", { ...identity, sourceType: "company", row: { ...row, businessMode: "products" } });
    assert.equal(Object.hasOwn(product.publicData, "serviceNames"), false);
    assert.equal(product.text.includes("Consulta inicial"), false);assert.equal(product.text.includes("Acompanhamento"), false);
    assert.notEqual(product.sourceHash, service.sourceHash);
  });
  await t.test("ONB-06 clearing names removes context without removing the company", () => {
    const base = { name: "Empresa", businessMode: "services" as const };
    const before = projectPublicBusinessSource("business-a", { ...identity, sourceType: "company", row: { ...base, storeSettings: { company: { serviceNames: ["Serviço público"] } } } });
    const cleared = projectPublicBusinessSource("business-a", { ...identity, sourceType: "company", row: { ...base, storeSettings: { company: { serviceNames: [] } } } });
    assert.notEqual(cleared.sourceHash, before.sourceHash);assert.equal(cleared.publicationState, "published");
    assert.equal(cleared.text.includes("Serviço público"), false);assert.equal(cleared.publicData.name, "Empresa");
    const history = { company: { serviceNames: [canary] } };
    const product = projectPublicBusinessSource("business-a", { ...identity, sourceType: "company", row: { ...base, businessMode: "products", storeSettings: history } });
    assert.equal(JSON.stringify(product).includes(canary), false);
  });
  await t.test("ONB-06 rejects malformed public lists rather than serializing nested private data", () => {
    for (const serviceNames of [null, {}, [canary, { private: canary }], [""], ["a".repeat(161)], Array.from({ length: 101 }, (_, i) => "Serviço " + i)]) {
      assert.throws(() => projectPublicBusinessSource("business-a", { ...identity, sourceType: "company", row: {
        name: "Empresa", businessMode: "services", storeSettings: { company: { serviceNames } },
      } }), /public_source_invalid/);
    }
  });
  await t.test("same projector accepts three unrelated business fixtures without domain-specific defaults", () => {
    for (const company of [
      { name: "Clínica Sintética", storeCategory: "Saúde", description: "Consultas de neurologia e informações sobre a clínica." },
      { name: "Salão Sintético", storeCategory: "Beleza", description: "Cortes, coloração e cuidados com os cabelos." },
      { name: "Consultoria Sintética", storeCategory: "Consultoria", description: "Orientação sobre processos e gestão empresarial." },
    ]) {
      const source = projectPublicBusinessSource("business-a", { ...identity, sourceType: "company", row: {
        name: company.name, storeCategory: company.storeCategory, storeSettings: { company: { description: company.description } },
      } });
      assert.equal(source.sourceType, "company");
      assert.equal(source.publicData.name, company.name);
      assert.equal(source.publicData.description, company.description);
      assert.ok(source.text.includes(company.description));
      assert.equal(source.text.includes("diagnóstico garantido"), false);
    }
  });
  await t.test("company projects stored business contacts without owner credential or admin fallback", () => {
    const source = projectPublicBusinessSource("business-a", { ...identity, sourceType: "company", row: {
      name: "Empresa Sintética", storeCategory: "Serviços", storeSettings: { company: { description: "Sobre a empresa", phone: "+5521999990000" } },
      users: [{ email: canary }], company: { email: canary }, accessToken: canary, payments: [{ secret: canary }],
    } } as unknown as PublicBusinessSourceInput);
    assert.deepEqual(source.publicData, { name: "Empresa Sintética", storeCategory: "Serviços", description: "Sobre a empresa", phone: "+5521999990000" });
    assert.equal(JSON.stringify(source).includes(canary), false);
  });
  await t.test("business hours excludes private staff calendar, blocks and reasons", () => {
    const source = projectPublicBusinessSource("business-a", { ...identity, sourceType: "business_hours", row: {
      storeSettings: { businessHours: [{ day: "Segunda-feira", startTime: "09:00", endTime: "18:00", closed: false },
        { day: "Domingo", startTime: "09:00", endTime: "18:00", closed: true }], calendar: [{ patient: canary }] },
      exceptions: [{ reason: canary }], staff: [{ email: canary }],
    } } as unknown as PublicBusinessSourceInput);
    assert.deepEqual(source.publicData.hours, [{ day: "Segunda-feira", startTime: "09:00", endTime: "18:00", closed: false }, { day: "Domingo", closed: true }]);
    assert.equal(JSON.stringify(source).includes(canary), false);
  });
  await t.test("professional copies published profile fields without login coupling or patients", () => {
    const source = projectPublicBusinessSource("business-a", { ...identity, sourceType: "professional", row: {
      publicName: "Profissional Sintético", publicProfile: { description: "Atendimento especializado", specialties: ["Área B", "Área A"], privateNotes: canary },
      timeZone: "America/Sao_Paulo", isActive: true, isPublished: true,
      userId: canary, email: canary, patients: [{ name: canary }],
    } } as unknown as PublicBusinessSourceInput);
    assert.deepEqual(source.publicData, { name: "Profissional Sintético", description: "Atendimento especializado", specialties: ["Área A", "Área B"], timeZone: "America/Sao_Paulo" });
    assert.equal(JSON.stringify(source).includes(canary), false);
  });
  await t.test("service includes public description and duration, never mutable price or a promise of slots", () => {
    const source = projectPublicBusinessSource("business-a", { ...identity, sourceType: "service", row: {
      name: "Serviço Sintético", description: "Atendimento presencial", type: "service", isActive: true, deletedAt: null,
      metadata: { serviceType: "presencial", serviceSchedule: { timeZone: "America/Sao_Paulo", durationMinutes: 30,
        slots: [{ id: canary, date: "2030-01-02", startTime: "10:00" }] }, privateNotes: canary },
      price: { basePriceInCents: 12345, providerToken: canary }, stock: [{ quantity: 42 }],
    } } as unknown as PublicBusinessSourceInput);
    assert.deepEqual(source.publicData, { name: "Serviço Sintético", description: "Atendimento presencial", serviceType: "presencial", durationMinutes: 30 });
    assert.equal(JSON.stringify(source).includes(canary), false);
    assert.equal(JSON.stringify(source).includes("12345"), false);
    assert.equal(Object.hasOwn(source.publicData, "slots"), false);
  });
  await t.test("faq and policy preserve public text but discard private siblings", () => {
    const faq = projectPublicBusinessSource("business-a", { ...identity, sourceType: "faq", row: {
      question: "Como funciona?", answer: "Conforme as condições publicadas.", internalNotes: canary,
    } } as unknown as PublicBusinessSourceInput);
    const policy = projectPublicBusinessSource("business-a", { ...identity, sourceType: "policy", row: {
      title: "Cancelamento", content: "Entre em contato para conhecer as condições.", operator: { email: canary },
    } } as unknown as PublicBusinessSourceInput);
    assert.deepEqual(faq.publicData, { question: "Como funciona?", answer: "Conforme as condições publicadas." });
    assert.deepEqual(policy.publicData, { title: "Cancelamento", content: "Entre em contato para conhecer as condições." });
    assert.equal(JSON.stringify([faq, policy]).includes(canary), false);
  });
  await t.test("service relationships include only linked published professionals and the same tenant category", () => {
    const row = { name: "Serviço Sintético", type: "service", isActive: true, deletedAt: null,
      category: { merchantId: "business-a", id: "category-a", name: "Categoria Sintética", isActive: true },
      professionals: [
        { merchantId: "business-a", professionalId: "professional-a", publicName: "Profissional A", isActive: true, isPublished: true, linkIsActive: true },
        { merchantId: "business-a", professionalId: "private-professional", publicName: canary, isActive: true, isPublished: false, linkIsActive: true },
      ] };
    const source = projectPublicBusinessSource("business-a", { ...identity, sourceType: "service", row });
    assert.deepEqual(source.publicData.professionals, [{ id: "professional-a", name: "Profissional A" }]);
    assert.deepEqual(source.publicData.category, { id: "category-a", name: "Categoria Sintética" });
    assert.equal(JSON.stringify(source).includes(canary), false);
    const withdrawnLink = projectPublicBusinessSource("business-a", { ...identity, sourceType: "service", row: {
      ...row, professionals: row.professionals.map(item => ({ ...item, linkIsActive: false })),
    } });
    assert.deepEqual(withdrawnLink.publicData.professionals, []);
    assert.notEqual(withdrawnLink.sourceHash, source.sourceHash);
    assert.throws(() => projectPublicBusinessSource("business-a", { ...identity, sourceType: "service", row: {
      ...row, category: { ...row.category, merchantId: "other-business" },
    } }), /public_source_foreign_tenant/);
  });
  await t.test("foreign tenant is rejected before producing retrievable content", () => {
    assert.throws(() => projectPublicBusinessSource("other-business", { ...identity, sourceType: "policy", row: { title: "Política", content: "Texto público" } }), /public_source_foreign_tenant/);
  });
  await t.test("draft and withdrawn sources carry provenance and no text or public data", () => {
    for (const publicationState of ["draft", "withdrawn"] as const) {
      const source = projectPublicBusinessSource("business-a", { ...identity, publicationState, sourceType: "company", row: { name: canary, storeSettings: { company: { description: canary } } } });
      assert.equal(source.publicationState, publicationState); assert.equal(source.text, ""); assert.deepEqual(source.publicData, {});
      assert.equal(source.merchantId, "business-a"); assert.equal(source.sourceId, "source-a"); assert.equal(source.sourceVersion, "canonical-version-4");
      assert.equal(JSON.stringify(source).includes(canary), false);
    }
  });
  await t.test("inactive or unpublished professional and withdrawn service cannot authorize stale text", () => {
    const professional = { publicName: canary, publicProfile: { description: canary }, timeZone: "UTC", isActive: true, isPublished: false };
    const service = { name: canary, type: "service", isActive: false, deletedAt: null };
    for (const input of [{ ...identity, sourceType: "professional", row: professional }, { ...identity, sourceType: "service", row: service }] as PublicBusinessSourceInput[]) {
      const source = projectPublicBusinessSource("business-a", input);
      assert.equal(source.publicationState, "withdrawn"); assert.equal(source.text, ""); assert.deepEqual(source.publicData, {});
      assert.equal(JSON.stringify(source).includes(canary), false);
    }
  });
  await t.test("hash depends on current public content and identity, independent of credentials or version churn", () => {
    const first = projectPublicBusinessSource("business-a", { ...identity, sourceType: "company", row: { name: "Empresa", storeSettings: { company: { description: "Descrição" } } } });
    const privateChange = projectPublicBusinessSource("business-a", { ...identity, sourceVersion: "next-version", sourceType: "company", row: {
      name: "Empresa", storeSettings: { company: { description: "Descrição" } }, token: canary,
    } } as unknown as PublicBusinessSourceInput);
    const publicChange = projectPublicBusinessSource("business-a", { ...identity, sourceType: "company", row: { name: "Empresa", storeSettings: { company: { description: "Nova descrição" } } } });
    const anotherSource = projectPublicBusinessSource("business-a", { ...identity, sourceId: "another-source", sourceType: "company", row: { name: "Empresa", storeSettings: { company: { description: "Descrição" } } } });
    assert.match(first.sourceHash, /^[a-f0-9]{64}$/);
    assert.equal(privateChange.sourceHash, first.sourceHash);
    assert.equal(privateChange.sourceVersion, "next-version");
    assert.notEqual(publicChange.sourceHash, first.sourceHash);
    assert.notEqual(anotherSource.sourceHash, first.sourceHash);
  });
});
