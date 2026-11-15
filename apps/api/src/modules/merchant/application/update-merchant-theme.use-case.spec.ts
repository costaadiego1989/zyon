import test from "node:test";
import assert from "node:assert/strict";
import { normalizeCompanySettingsPatch, mergeCompanySettingsPatch } from "./company-settings-write.js";
import { UpdateMerchantThemeUseCase } from "./update-merchant-theme.use-case.js";
import { InMemoryMerchantRepository } from "../infrastructure/in-memory-merchant.repository.js";

test("T13", async t => {
  await t.test("ONB-05 preserves omitted fields and explicitly clears only the public introduction", () => {
    const current = { company: { description: "Apresentação", email: "comercial@example.test", address: { street: "Rua A", city: "Cidade" } }, policies: { terms: "Termos" }, concurrent: "preservado" };
    const next = mergeCompanySettingsPatch(current, normalizeCompanySettingsPatch({ company: { phone: "11999999999", address: { number: "10" } } }));
    assert.deepEqual(next, { ...current, company: { ...current.company, phone: "11999999999", address: { ...current.company.address, number: "10" } } });
    const clear = mergeCompanySettingsPatch(current, normalizeCompanySettingsPatch({ company: { description: "" } }));
    assert.deepEqual(clear, { ...current, company: { ...current.company, description: "" } });
    assert.equal(current.company.description, "Apresentação");
  });
  await t.test("ONB-05 enforces type and1200 limit in the actual merchant use case before persistence", async () => {
    const repo = new InMemoryMerchantRepository(), writes: unknown[] = [];
    repo.updateStoreSettings = async (_id, settings) => { writes.push(settings); return settings; };
    const useCase = new UpdateMerchantThemeUseCase(repo);
    for (const value of [null, [], {}, 7, false, "a".repeat(1201)]) {
      await assert.rejects(useCase.updateStoreSettings("own", { company: { description: value } }), /invalid_company_description/);
    }
    for (const company of [null, [], "text"]) await assert.rejects(useCase.updateStoreSettings("own", { company }), /invalid_company_settings/);
    assert.deepEqual(writes, []);
    assert.deepEqual(await useCase.updateStoreSettings("own", { company: { description: "  Empresa pública  " } }), { company: { description: "Empresa pública" } });
    assert.deepEqual(await useCase.updateStoreSettings("own", { company: { description: "a".repeat(1200) } }), { company: { description: "a".repeat(1200) } });
    assert.deepEqual(await useCase.updateStoreSettings("own", { company: { description: "" } }), { company: { description: "" } });
    assert.equal(writes.length, 3);
  });
});
