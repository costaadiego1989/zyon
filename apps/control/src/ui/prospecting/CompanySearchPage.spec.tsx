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
const published = { source: { status: "current", value: { snapshotId: "out", state: "published", competence: "2026-10" }, observedAt: "2026-11-22T12:00:00Z" } };
const preparing = { source: { status: "unavailable", value: { snapshotId: null, state: "unavailable", competence: null }, observedAt: null } };
function searchProps(methods: Parameters<typeof screenProps>[0]) {
  return screenProps({ readiness: async () => published, ...methods });
}
test("PROS-24 AC1 filtros e paginação conservam a seleção do snapshot e centavos exatos", async () => {
  const companies = vi
    .fn()
    .mockResolvedValueOnce(page())
    .mockResolvedValueOnce(page(first, "next"))
    .mockResolvedValueOnce(page(second))
    .mockResolvedValue(page(second));
  const addProspects = vi.fn().mockResolvedValue({ created: 1, existing: 1, prospectIds: ["p1", "p2"] });
  const ui = await show(<CompanySearchPage {...searchProps({ companies, domains, addProspects })} />);
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
    <CompanySearchPage {...searchProps({ companies: async () => page(), domains, createSegment })} />
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
  const ui = await show(<CompanySearchPage {...searchProps({ companies, domains })} />);
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
  const ui = await show(<CompanySearchPage {...searchProps({ companies, domains: lookup })} />);
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
  const ui = await show(<CompanySearchPage {...searchProps({ companies, domains })} />);
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


test("DIR-01 pending publication prevents company and domain requests until availability is confirmed", async()=>{
  const readiness=vi.fn().mockResolvedValueOnce(preparing).mockResolvedValue(published);
  const companies=vi.fn().mockResolvedValue(page()), lookup=vi.fn(async(q)=>({items:q.kind==='cnaes'?[{kind:'cnaes',code:'4711301',label:'Atividade oficial'}]:[],nextCursor:null}));
  const ui=await show(<CompanySearchPage {...searchProps({readiness,companies,domains:lookup})}/>);
  expect(ui.text()).toContain('Base nacional em preparação');expect(ui.text()).toContain('importação e a validação');
  expect(ui.host.querySelector('[role=alert]')).toBeNull();expect(ui.host.querySelector('form')).toBeNull();
  expect(companies).not.toHaveBeenCalled();expect(lookup).not.toHaveBeenCalled();
  await ui.click('Verificar disponibilidade');
  expect(readiness).toHaveBeenCalledTimes(2);expect(companies).toHaveBeenCalledTimes(1);
  expect(ui.host.querySelector('select[name="mainCnaes"] option[value="4711301"]')?.textContent).toBe('Atividade oficial · 4711301');
  expect(ui.text()).toContain('Oficina '+first);expect(ui.text()).not.toContain('Base nacional em preparação');
});

test("DIR-02 incomplete or stale publication observations cannot enable search",async()=>{
  for(const source of [
    undefined,
    null,
    {status:'current',value:{snapshotId:'out',state:'importing'}},
    {status:'current',value:{snapshotId:null,state:'published'}},
    {status:'stale',value:{snapshotId:'out',state:'published'}},
    {status:'stale',value:{snapshotId:null,state:'unavailable'}},
    {status:'unavailable',value:null},
    {status:'unavailable',value:{snapshotId:'retained-but-unverified',state:'unavailable'}},
    {status:'unavailable',value:{snapshotId:'',state:'unavailable'}},
  ]){
    const readiness=vi.fn().mockResolvedValueOnce({source}).mockResolvedValue(published);
    const companies=vi.fn().mockResolvedValue(page()),lookup=vi.fn(domains);
    const ui=await show(<CompanySearchPage {...searchProps({readiness,companies,domains:lookup})}/>);
    expect(ui.host.querySelector('[role=alert]')).not.toBeNull();expect(ui.text()).not.toContain('Base nacional em preparação');
    expect(companies).not.toHaveBeenCalled();expect(lookup).not.toHaveBeenCalled();
    await ui.click('Tentar novamente');expect(readiness).toHaveBeenCalledTimes(2);expect(ui.text()).toContain('Oficina '+first);
  }
});

test("DIR-03 pending readiness hides directory controls and real failures retain retry and session handling",async()=>{
  let resolve!:(value:unknown)=>void;
  const companies=vi.fn().mockResolvedValue(page()),lookup=vi.fn(domains);
  const props=searchProps({readiness:()=>new Promise(done=>{resolve=done;}),companies,domains:lookup});
  const pending=await show(<CompanySearchPage {...props}/>);expect(pending.text()).toContain('Carregando');expect(companies).not.toHaveBeenCalled();expect(lookup).not.toHaveBeenCalled();
  await act(async()=>resolve(preparing));expect(pending.text()).toContain('Base nacional em preparação');
  for(const status of [500,403,401]){
    const readiness=vi.fn().mockRejectedValueOnce(new PlatformApiError(status)).mockResolvedValue(published);
    const own=searchProps({readiness,companies,domains:lookup});const ui=await show(<CompanySearchPage {...own}/>);
    expect(ui.text()).not.toContain('Base nacional em preparação');expect(ui.host.querySelector('[role=alert]')).not.toBeNull();
    expect(own.onSessionExpired).toHaveBeenCalledTimes(status===401?1:0);
    if(status===500){expect(ui.text()).toContain('Não foi possível');await ui.click('Tentar novamente');expect(ui.text()).toContain('Oficina '+first);}
    else expect(ui.text()).toContain('permissão');
  }
});
test("DIR-03 empty or malformed readiness responses are retryable without starting directory requests",async()=>{
  for(const payload of [null,undefined,false,0,"",[],"invalid"]){
    const readiness=vi.fn().mockResolvedValueOnce(payload).mockResolvedValue(published);
    const companies=vi.fn().mockResolvedValue(page()),lookup=vi.fn(domains);
    const ui=await show(<CompanySearchPage {...searchProps({readiness,companies,domains:lookup})}/>);
    expect(ui.host.querySelector('[role=alert]')?.textContent).toBe('Não foi possível carregar os dados.');
    expect(ui.text()).not.toContain('Base nacional em preparação');expect(companies).not.toHaveBeenCalled();expect(lookup).not.toHaveBeenCalled();
    await ui.click('Tentar novamente');expect(readiness).toHaveBeenCalledTimes(2);expect(ui.text()).toContain('Oficina '+first);
  }
});
