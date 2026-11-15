import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCompanySettingsPatch, mergeCompanySettingsPatch, assertCompanyServiceNamesMode } from "./company-settings-write.js";
import { mapCompanySettings } from "./company-settings.mapper.js";
import { projectPublicBusinessSource } from "../../graph-rag/domain/public-business-source.js";
import { GetStoreConfigUseCase } from "../../storefront/application/use-cases/get-store-config.use-case.js";

test("T96", async t => {
  await t.test("ONB-06 trims names and enforces100 names and160 characters with clear duplicate rejection", () => {
    const incoming = ["  Consulta comercial  ", "Avaliação"];
    assert.deepEqual(normalizeCompanySettingsPatch({ company: { serviceNames: incoming } }), { company: { serviceNames: ["Consulta comercial", "Avaliação"] } });
    assert.deepEqual(incoming, ["  Consulta comercial  ", "Avaliação"]);
    const hundred = Array.from({ length: 100 }, (_, index) => String(index).padStart(3, "0") + "a".repeat(157));
    assert.deepEqual(normalizeCompanySettingsPatch({ company: { serviceNames: hundred } }), { company: { serviceNames: hundred } });
    for (const serviceNames of [null, {}, "Consulta", true, [7], [null], [""], ["  "], ["a".repeat(161)], [...hundred, "Extra"], ["Consulta", " consulta "], ["A", "Ａ"]])
      assert.throws(() => normalizeCompanySettingsPatch({ company: { serviceNames } }), /company_service_name/);
  });
  await t.test("ONB-06 omission preserves history and an explicit empty list clears only names", () => {
    const stored = { company: { description: "Publico", email: "public@example.test", serviceNames: ["Consulta"] }, policies: { terms: "Termos" } };
    assert.deepEqual(mergeCompanySettingsPatch(stored, normalizeCompanySettingsPatch({ company: { phone: "11999999999" } })), { ...stored, company: { ...stored.company, phone: "11999999999" } });
    assert.deepEqual(mergeCompanySettingsPatch(stored, normalizeCompanySettingsPatch({ company: { serviceNames: [] } })), { ...stored, company: { ...stored.company, serviceNames: [] } });
    assert.deepEqual(stored.company.serviceNames, ["Consulta"]);
  });
  await t.test("ONB-06 company responses publish names only for the canonical services mode", () => {
    const company = { description: "Publico", serviceNames: ["Consulta"], privateNote: "PRIVATE_CANARY" };
    assert.deepEqual(mapCompanySettings(company, undefined, "services"), { description: "Publico", serviceNames: ["Consulta"] });
    assert.deepEqual(mapCompanySettings(company, undefined, "products"), { description: "Publico" });
  });
  await t.test("ONB-06 committed RAG projection uses names as public context only in services", () => {
    const input = { merchantId: "own", sourceId: "own", sourceVersion: "opaque", sourceType: "company" as const, publicationState: "published" as const,
      row: { name: "Empresa", businessMode: "services" as const, storeSettings: { company: { serviceNames: ["Consulta comercial"], credentials: { token: "PRIVATE_CANARY" } } } } };
    const service = projectPublicBusinessSource("own", input);
    assert.deepEqual(service.publicData.serviceNames, ["Consulta comercial"]); assert.match(service.text, /Consulta comercial/);
    const product = projectPublicBusinessSource("own", { ...input, row: { ...input.row, businessMode: "products" } });
    assert.equal(Object.hasOwn(product.publicData, "serviceNames"), false); assert.doesNotMatch(product.text, /Consulta comercial|PRIVATE_CANARY/);
    assert.notEqual(product.sourceHash, service.sourceHash); assert.deepEqual(input.row.storeSettings.company.serviceNames, ["Consulta comercial"]);
  });
  await t.test("ONB-06 products rejects explicit writes including clear and permits unrelated patches", () => {
    for (const serviceNames of [["Consulta"], []]) {
      assert.throws(() => assertCompanyServiceNamesMode({ company: { serviceNames } }, "products"), /company_service_names_requires_services/);
      assert.doesNotThrow(() => assertCompanyServiceNamesMode({ company: { serviceNames } }, "services"));
    }
    assert.doesNotThrow(() => assertCompanyServiceNamesMode({ company: { phone: "11999999999" } }, "products"));
  });
  await t.test("ONB-06 storefront strips only service names after canonical mode changes without mutating stored JSON", async () => {
    const stored = { company: { description: "Public description", serviceNames: ["Public consultation"], phone: "11999999999" }, policies: { terms: "Public terms" } };
    const row = { id: "own", name: "Public business", businessMode: "services" as "products" | "services", theme: null, storeCategory: null, storeSettings: stored };
    const useCase = new GetStoreConfigUseCase({ findPublicConfig: async () => ({ merchant: row, stories: [] }) });
    assert.deepEqual((await useCase.execute("own")).storeSettings, stored);
    row.businessMode = "products";
    const result = await useCase.execute("own");
    assert.deepEqual(result.storeSettings, { company: { description: "Public description", phone: "11999999999" }, policies: { terms: "Public terms" } });
    assert.deepEqual(stored.company.serviceNames, ["Public consultation"]);
    assert.notEqual(result.storeSettings, stored);
  });
});
