import test from "node:test";
import assert from "node:assert/strict";
import { estimatePacQuote, lookupAddressByViaCep } from "./viacep-lookup.service.js";

test("lookupAddressByViaCep maps ViaCEP JSON into CustomerAddress-shaped fields", async () => {
  const fakeFetch = async () =>
    new Response(
      JSON.stringify({
        cep: "01001-000",
        logradouro: "Praça da Sé",
        complemento: "lado ímpar",
        bairro: "Sé",
        localidade: "São Paulo",
        uf: "SP"
      }),
      { status: 200 }
    );

  const hit = await lookupAddressByViaCep("01001-000", fakeFetch as unknown as typeof fetch);
  assert.deepEqual(hit, {
    zip: "01001000",
    street: "Praça da Sé",
    complement: "lado ímpar",
    neighborhood: "Sé",
    city: "São Paulo",
    state: "SP"
  });
});

test("lookupAddressByViaCep returns null on erro:true", async () => {
  const fakeFetch = async () =>
    new Response(JSON.stringify({ erro: true }), { status: 200 });
  const hit = await lookupAddressByViaCep("99999999", fakeFetch as unknown as typeof fetch);
  assert.equal(hit, null);
});

test("estimatePacQuote prices Southeast lower than distant states", () => {
  const sp = estimatePacQuote({ zip: "01001000", state: "SP" });
  const am = estimatePacQuote({ zip: "69000000", state: "AM" });
  assert.equal(sp.customerPrice < am.customerPrice, true);
});
