import test from "node:test";
import assert from "node:assert/strict";
import { mapCompanySettings } from "./company-settings.mapper.js";

test("T14", async t => {
  await t.test("ONB-05 public company fields roundtrip and explicit empty description stays empty", () => {
    const company = { description: "Descrição pública", cnpj: "123", razaoSocial: "Empresa", inscricaoEstadual: "IE", email: "comercial@example.test", phone: "11999999999", address: { street: "Rua", number: "5", complement: "Sala", neighborhood: "Bairro", city: "Cidade", state: "SP", zip: "12345678" } };
    assert.deepEqual(mapCompanySettings(company), company);
    assert.deepEqual(mapCompanySettings({ ...company, description: "" }), { ...company, description: "" });
    assert.equal(mapCompanySettings({ description: "a".repeat(1201) }).description, "a".repeat(1201), "Reading existing canonical data never silently truncates or hides it");
    assert.deepEqual(mapCompanySettings({ phone: "111" }, "Nome comercial"), { phone: "111", razaoSocial: "Nome comercial" });
  });
  await t.test("RAG-11 secrets and authentication-email canaries are never public company fields", () => {
    const source = { description: "Público", privateEmail: "login-canary@example.test", credentials: { token: "SECRET_CANARY" }, password: "SECRET_CANARY", address: { city: "Cidade", privateNote: "SECRET_CANARY" }, user: { email: "login-canary@example.test" } };
    assert.deepEqual(mapCompanySettings(source), { description: "Público", address: { city: "Cidade" } });
    assert.equal(JSON.stringify(mapCompanySettings(source)).includes("CANARY"), false);
    assert.deepEqual(mapCompanySettings(undefined), {});
    assert.deepEqual(mapCompanySettings({ description: { private: "secret" }, email: null }), {});
  });
});
