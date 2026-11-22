import { expect, test, vi } from "vitest";
import { act } from "react";
import { CompanySearchPage } from "./CompanySearchPage.js";
import { PlatformApiError } from "../../lib/api.js";
import { screenProps, show } from "./screen-test.js";
const first = "00000000000191",
  second = "12ABC34501DE35";
function page(cnpj = first, nextCursor: string | null = null) {
  return {
    snapshotId: "out",
    competence: "2026-10",
    count: 271,
    countState: "complete",
    filterHash: "national",
    nextCursor,
    items: [{ cnpj, legalName: "Oficina " + cnpj, capitalCents: "900719925474099317", uf: "SP", contacts: [] }],
  };
}
const domains = async () => ({ items: [], nextCursor: null });
test("PROS-24 AC1 filtros e paginação conservam a seleção do snapshot e centavos exatos", async () => {
  const companies = vi
    .fn()
    .mockResolvedValueOnce(page())
    .mockResolvedValueOnce(page(first, "next"))
    .mockResolvedValueOnce(page(second))
    .mockResolvedValue(page(second));
  const addProspects = vi.fn().mockResolvedValue({ created: 1, existing: 1, prospectIds: ["p1", "p2"] });
  const ui = await show(<CompanySearchPage {...screenProps({ companies, domains, addProspects })} />);
  await ui.fill("Capital mínimo (R$)", "9007199254740993,17");
  await ui.fill("UF", "SP");
  await ui.click("Aplicar filtros");
  expect(companies.mock.calls[1][0].filters).toMatchObject({ capitalMinCents: "900719925474099317", ufs: ["SP"] });
  expect(ui.text()).toContain("Capital social · R$ 9.007.199.254.740.993,17");
  expect(ui.text()).toContain("9.007.199.254.740.993,17");
  expect(ui.text()).toContain("271 empresas");
  await ui.check("Selecionar " + first);
  await ui.click("Próxima página");
  await ui.check("Selecionar " + second);
  await ui.click("Adicionar ao CRM");
  expect(addProspects.mock.calls[0][0]).toMatchObject({ snapshotId: "out", cnpjs: [first, second] });
  expect(ui.text()).toContain("1 criada(s) e 1 já existente(s)");
});
test("PROS-24 AC2 salvar segmento usa filtros aplicados e mostra o resultado confirmado", async () => {
  const createSegment = vi
    .fn()
    .mockResolvedValue({ name: "Segmento oficial", count: 23, version: 4, countState: "complete" });
  const ui = await show(
    <CompanySearchPage {...screenProps({ companies: async () => page(), domains, createSegment })} />
  );
  await ui.fill("CNPJ", "12ABC34501DE35");
  await ui.click("Aplicar filtros");
  await ui.fill("Nome do segmento", "Oficinas");
  await ui.click("Salvar segmento");
  expect(createSegment.mock.calls[0][0]).toMatchObject({ name: "Oficinas", filters: { cnpj: second } });
  expect(ui.text()).toContain("Segmento oficial");
  expect(ui.text()).toContain("23 empresas");
  expect(ui.text()).toContain("versão 4");
});
test("PROS-24 AC3 carregamento, vazio, erro e acesso negado invalidam ações pendentes", async () => {
  let finish!: (value: unknown) => void;
  const companies = vi
    .fn()
    .mockResolvedValueOnce(page())
    .mockImplementationOnce(() => new Promise((resolve) => (finish = resolve)))
    .mockRejectedValueOnce(new Error())
    .mockRejectedValueOnce(new PlatformApiError(403));
  const ui = await show(<CompanySearchPage {...screenProps({ companies, domains })} />);
  await ui.check("Selecionar " + first);
  await ui.fill("Pesquisar empresa", "Outra");
  await ui.click("Aplicar filtros");
  expect(ui.text()).toContain("Carregando");
  expect(ui.host.querySelector("input[type=checkbox]")).toBeNull();
  await act(async () => finish({ ...page(), items: [], count: 0 }));
  expect(ui.text()).toContain("Nenhuma empresa");
  await ui.click("Aplicar filtros");
  expect(ui.text()).toContain("Não foi possível");
  await ui.click("Tentar novamente");
  expect(ui.text()).toContain("permissão");
  expect(ui.text()).not.toContain("Adicionar ao CRM");
});

test("PROS-24 AC1 opções oficiais de município distinguem UF e preservam o código importado", async () => {
  const lookup = vi.fn(async (q) => ({
    items:
      q.kind === "municipios"
        ? [{ kind: "municipios", code: q.uf === "SP" ? "7107" : "6001", label: "Santa Cruz" }]
        : [],
    nextCursor: null,
  }));
  const companies = vi.fn().mockResolvedValue(page());
  const ui = await show(<CompanySearchPage {...screenProps({ companies, domains: lookup })} />);
  expect(ui.control("Município").disabled).toBe(true);
  await ui.fill("UF", "RJ");
  expect(ui.text()).toContain("Santa Cruz · 6001 · RJ");
  await ui.fill("Município", "6001");
  await ui.fill("UF", "SP");
  expect(ui.text()).not.toContain("6001");
  await ui.fill("Município", "7107");
  await ui.click("Aplicar filtros");
  expect(companies.mock.lastCall?.[0].filters).toEqual({ ufs: ["SP"], cityCodes: ["7107"] });
});

test("PROS-24 AC1 incluir dois valores da mesma dimensão conserva OR no pedido ao servidor", async () => {
  const companies = vi.fn().mockResolvedValue(page());
  const ui = await show(<CompanySearchPage {...screenProps({ companies, domains })} />);
  await ui.fill("UF", "RJ");
  await ui.fill("Filtro com múltiplos valores", "ufs");
  await ui.click("Manter valor");
  await ui.fill("UF", "SP");
  await ui.fill("Estágio no CRM", "responded");
  await ui.fill("Filtro com múltiplos valores", "stages");
  await ui.click("Manter valor");
  await ui.fill("Estágio no CRM", "qualified");
  await ui.click("Aplicar filtros");
  expect(companies.mock.lastCall?.[0].filters).toEqual({ ufs: ["SP", "RJ"], stages: ["qualified", "responded"] });
  await ui.click("Remover UF · RJ");
  await ui.click("Aplicar filtros");
  expect(companies.mock.lastCall?.[0].filters.ufs).toEqual(["SP"]);
});
