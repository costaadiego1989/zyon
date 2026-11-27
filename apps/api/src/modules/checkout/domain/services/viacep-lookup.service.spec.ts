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

test("postal lookup uses the same CEP at BrasilAPI when ViaCEP is unreachable", async () => {
  const calls: string[] = [];
  const hit = await lookupAddressByViaCep("01001-000", (async (input: string | URL | Request) => {
    calls.push(String(input));
    if (calls.length === 1) throw Object.assign(new TypeError("fetch failed"), { cause: { code: "EHOSTUNREACH" } });
    return Response.json({ cep: "01001000", street: "Praça da Sé", neighborhood: "Sé", city: "São Paulo", state: "sp" });
  }) as typeof fetch);
  assert.deepEqual(calls, ["https://viacep.com.br/ws/01001000/json/", "https://brasilapi.com.br/api/cep/v2/01001000"]);
  assert.deepEqual(hit, { zip: "01001000", street: "Praça da Sé", complement: undefined, neighborhood: "Sé", city: "São Paulo", state: "SP" });
});

test("postal lookup falls back on provider outage with an independent live signal", async () => {
  let calls = 0;
  const hit = await lookupAddressByViaCep("01001000", (async (_: unknown, init?: RequestInit) => {
    assert.equal(init?.signal?.aborted, false);
    return ++calls === 1 ? new Response("unavailable", { status: 503 })
      : Response.json({ cep: "01001000", street: "Praça da Sé", city: "São Paulo", state: "SP" });
  }) as typeof fetch);
  assert.equal(calls, 2);
  assert.equal(hit?.street, "Praça da Sé");
});

test("a definitive invalid CEP never queries a second provider", async () => {
  for (const status of [200, 404]) {
    let calls = 0;
    assert.equal(await lookupAddressByViaCep("99999999", (async () => {
      calls++;
      return Response.json({ erro: true }, { status });
    }) as typeof fetch), null);
    assert.equal(calls, 1);
  }
});

test("postal fallback rejects a different CEP or incomplete provider response", async () => {
  for (const body of [{ cep: "02002000", city: "São Paulo", state: "SP" }, { cep: "01001000", state: "SP" }]) {
    let calls = 0;
    assert.equal(await lookupAddressByViaCep("01001000", (async () => {
      if (++calls === 1) throw new Error("network unavailable");
      return Response.json(body);
    }) as typeof fetch), null);
    assert.equal(calls, 2);
  }
});

test("two unavailable postal providers stay bounded and never invent an address", async () => {
  let calls = 0;
  assert.equal(await lookupAddressByViaCep("01001000", (async () => { calls++; throw new Error("network unavailable"); }) as typeof fetch), null);
  assert.equal(calls, 2);
  assert.equal(await lookupAddressByViaCep("123", (async () => { throw new Error("must not call network"); }) as typeof fetch), null);
});
