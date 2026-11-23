import { expect, test, vi } from "vitest";
import type {CompanyDomainQuery,CompanySearchQuery} from "@zyon/shared-types";
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
const regionalCoverage={kind:"regional_retail",ufs:["SP","RJ","MG","ES","PR","SC","RS"],mainCnaes:["4781400","4772500"],companyCount:12345,maximumDirectoryBytes:25_000_000_000,scopeComplete:true};
function searchProps(methods: Parameters<typeof screenProps>[0]) {
  return screenProps({ readiness: async () => published, ...methods });
}
const partialSource=(id='partial-a',count=500)=>({source:{status:'current',value:{snapshotId:id,state:'published',competence:'2026-11',coverage:{...regionalCoverage,companyCount:count,scopeComplete:false},latestImport:{id:'parent',state:'importing',phase:'persisting_establishments',committedCount:count*2,selectedCompanies:1000000,validatedFiles:23,totalFiles:23,errorCode:null,updatedAt:'2026-11-23T19:00:00Z'}},observedAt:'2026-11-23T19:00:00Z'}});

async function pickDomain(ui: Awaited<ReturnType<typeof show>>, label: string, code: string) {
 await act(async()=>ui.control(label).click());
 const find=()=>Array.from(document.querySelectorAll<HTMLElement>('[role=option]')).find(option=>option.querySelector('small')?.textContent?.split(' · ')[0]===code);
 if(!find())await ui.fill(label,code);
 expect(find(),label+' option '+code).toBeDefined();
 await act(async()=>find()!.click());
}
async function domainMore() {
 const button=document.querySelector<HTMLButtonElement>('.prospecting-domain-more');expect(button).not.toBeNull();
 await act(async()=>button!.click());
}
test('SEARCH-01 options accumulate and a new search resets the cursor while retaining the chosen code',async()=>{
 const lookup=vi.fn(async(q:CompanyDomainQuery)=>({items:q.kind!=='municipios'?[]:q.afterCode||q.search?[{kind:'municipios',code:'8105',label:'FLORIANOPOLIS'}]:[{kind:'municipios',code:'7107',label:'SAO PAULO'}],nextCursor:q.kind==='municipios'&&!q.afterCode&&!q.search?'7107':null}));
 const companies=vi.fn().mockResolvedValue(page()),ui=await show(<CompanySearchPage {...searchProps({companies,domains:lookup})}/>);
 await ui.fill('UF','SC');await act(async()=>ui.control('Município').click());await domainMore();
 expect(Array.from(document.querySelectorAll('[role=option] small')).map(o=>o.textContent?.split(' · ')[0])).toEqual(['7107','8105']);
 await pickDomain(ui,'Município','7107');await ui.fill('Município','florian');
 expect(lookup.mock.calls.filter(([q])=>q.kind==='municipios').at(-1)?.[0]).toMatchObject({search:'florian',afterCode:undefined,uf:'SC'});
 expect(new FormData(ui.host.querySelector('form')!).get('cityCodes')).toBe('7107');await pickDomain(ui,'Município','8105');await ui.click('Aplicar filtros');
 expect(companies.mock.lastCall?.[0].filters).toEqual({ufs:['SC'],cityCodes:['8105']});
});

function directoryPages(count=53){
 return vi.fn(async(q:CompanySearchQuery)=>{
  const total=q.snapshotId==='partial-b'?81:count,offset=q.cursor?Number(q.cursor.split(':')[1]):0,limit=q.limit??50;
  return {...page(),snapshotId:q.snapshotId??'partial-a',count:total,items:Array.from({length:Math.max(0,Math.min(limit,total-offset))},(_,index)=>({cnpj:String(offset+index+1).padStart(14,'0'),legalName:'Empresa '+(offset+index+1),capitalCents:'10000',uf:'SC',contacts:[]})),nextCursor:offset+limit<total?'offset:'+(offset+limit):null};
 });
}

test('SEARCH-03 single searchable filters preserve selection while browsing and commit only official codes',async()=>{
 const companies=vi.fn().mockResolvedValue(page(first,'next'));
 const lookup=async(q:CompanyDomainQuery)=>({items:q.kind==='cnaes'?[{kind:'cnaes',code:'4781400',label:'Vestuário'}]:[],nextCursor:null});
 const ui=await show(<CompanySearchPage {...searchProps({companies,domains:lookup})}/>);
 expect(ui.host.querySelectorAll('[role=combobox]')).toHaveLength(3);
 expect(ui.text()).not.toContain('Buscar cnae principal');expect(ui.text()).not.toContain('Mais opções de');
 await ui.check('Selecionar '+first);await ui.fill('CNAE principal','vest');
 expect(ui.control('Selecionar '+first).checked).toBe(true);
 expect(new FormData(ui.host.querySelector('form')!).get('mainCnaes')).toBe('');
 await act(async()=>ui.control('CNAE principal').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 expect(document.querySelector('[role=listbox]')).toBeNull();expect(ui.control('Selecionar '+first).checked).toBe(true);
 await ui.fill('CNAE principal','vest');
 await act(async()=>ui.control('CNAE principal').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})));
 expect(ui.control('CNAE principal').value).toBe('Vestuário · 4781400');expect(ui.control('Selecionar '+first).checked).toBe(false);
 await ui.click('Aplicar filtros');expect(companies.mock.lastCall?.[0].filters).toEqual({mainCnaes:['4781400']});
});

test('SEARCH-03 saved search is optional above results and multiple domain values preserve OR',async()=>{
 const companies=vi.fn().mockResolvedValue(page());
 const lookup=async(q:CompanyDomainQuery)=>({items:q.kind==='cnaes'?[{kind:'cnaes',code:'4781400',label:'Vestuário'},{kind:'cnaes',code:'4782201',label:'Calçados'}]:[],nextCursor:null});
 const ui=await show(<CompanySearchPage {...searchProps({companies,domains:lookup})}/>);
 expect(ui.text()).not.toContain('Nome do segmento');expect(ui.host.querySelector('#save-company-search')).toBeNull();
 await pickDomain(ui,'CNAE principal','4781400');await ui.fill('Filtro com múltiplos valores','mainCnaes');await ui.click('Manter valor');
 expect(ui.text()).toContain('Remover CNAE principal · Vestuário');
 await pickDomain(ui,'CNAE principal','4782201');await ui.click('Aplicar filtros');
 expect(companies.mock.lastCall?.[0].filters).toEqual({mainCnaes:['4782201','4781400']});
 await ui.click('Salvar busca');expect(document.activeElement).toBe(ui.control('Nome da busca'));
 expect(ui.host.querySelector('#save-company-search')!.compareDocumentPosition(ui.host.querySelector('.prospecting-rows')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 await ui.click('Cancelar');expect(ui.host.querySelector('#save-company-search')).toBeNull();
 await ui.fill('Pesquisar empresa','pet');expect(ui.button('Salvar busca').disabled).toBe(true);
});
test('SEARCH-02 pages request20 and display the exact first, middle and last page sizes',async()=>{
 const companies=directoryPages(),ui=await show(<CompanySearchPage {...searchProps({readiness:async()=>partialSource('partial-a',53),companies,domains})}/>);
 expect(companies.mock.calls[0][0].limit).toBe(20);expect(ui.host.querySelectorAll('.prospecting-row')).toHaveLength(20);expect(ui.text()).toContain('Página 1 de 3');
 expect(ui.button('Página anterior').disabled).toBe(true);await ui.click('Próxima página');expect(ui.text()).toContain('Página 2 de 3');expect(ui.host.querySelectorAll('.prospecting-row')).toHaveLength(20);
 await ui.click('Próxima página');expect(ui.text()).toContain('Página 3 de 3');expect(ui.host.querySelectorAll('.prospecting-row')).toHaveLength(13);expect(ui.button('Próxima página').disabled).toBe(true);
 expect(companies.mock.calls.every(([q])=>q.limit===20)).toBe(true);
});
test('SEARCH-02 pages show one empty page without inventing company results',async()=>{
 const ui=await show(<CompanySearchPage {...searchProps({companies:directoryPages(0),domains})}/>);
 expect(ui.text()).toContain('Página 1 de 1');expect(ui.text()).toContain('Nenhuma empresa');expect(ui.host.querySelectorAll('.prospecting-row')).toHaveLength(0);
 expect(ui.button('Página anterior').disabled).toBe(true);expect(ui.button('Próxima página').disabled).toBe(true);
});
test('SEARCH-02 pages reload the first page when a filtered count shrinks below the current cursor',async()=>{
 const directory=directoryPages();let shrunk=false;
 const companies=vi.fn(async(q:CompanySearchQuery)=>{
  const response=await directory(q);
  if(q.cursor){shrunk=true;return {...response,count:1,items:[],nextCursor:null};}
  return shrunk?{...response,count:1,items:response.items.slice(0,1),nextCursor:null}:response;
 });
 const ui=await show(<CompanySearchPage {...searchProps({readiness:async()=>partialSource('partial-a',53),companies,domains})}/>);
 await ui.fill('Estágio no CRM','new');await ui.click('Aplicar filtros');await ui.click('Próxima página');
 expect(ui.text()).toContain('Página 1 de 1');expect(ui.text()).not.toContain('Página 2 de 1');expect(ui.host.querySelectorAll('.prospecting-row')).toHaveLength(1);expect(ui.text()).toContain('Empresa 1');
 expect(companies.mock.lastCall?.[0]).toMatchObject({snapshotId:'partial-a',filters:{stages:['new']},limit:20});expect(companies.mock.lastCall?.[0].cursor).toBeUndefined();expect(ui.button('Próxima página').disabled).toBe(true);
});
test('SEARCH-02 navigation retains filter, snapshot, cursor history and selection',async()=>{
 const companies=directoryPages(),ui=await show(<CompanySearchPage {...searchProps({readiness:async()=>partialSource('partial-a',53),companies,domains})}/>);
 await ui.fill('UF','SC');await ui.click('Aplicar filtros');await ui.check('Selecionar 00000000000001');await ui.click('Próxima página');
 expect(companies.mock.lastCall?.[0]).toMatchObject({snapshotId:'partial-a',filters:{ufs:['SC']},cursor:'offset:20',limit:20});
 await ui.click('Próxima página');await ui.click('Página anterior');expect(ui.text()).toContain('Página 2 de 3');expect(companies.mock.lastCall?.[0].cursor).toBe('offset:20');
 await ui.click('Página anterior');expect(ui.text()).toContain('Página 1 de 3');expect(companies.mock.lastCall?.[0].cursor).toBeUndefined();expect(ui.control('Selecionar 00000000000001').checked).toBe(true);
 await ui.click('Próxima página');await ui.click('Primeira página');expect(ui.text()).toContain('Página 1 de 3');expect(companies.mock.lastCall?.[0]).toMatchObject({snapshotId:'partial-a',filters:{ufs:['SC']},limit:20});
});
test('SEARCH-02 reset returns filters and a refreshed partial view to page1',async()=>{
 const readiness=vi.fn().mockResolvedValueOnce(partialSource('partial-a',53)).mockResolvedValue(partialSource('partial-b',81));
 const companies=directoryPages(),ui=await show(<CompanySearchPage {...searchProps({readiness,companies,domains})}/>);
 await ui.click('Próxima página');await ui.fill('Pesquisar empresa','pet');await ui.click('Aplicar filtros');expect(ui.text()).toContain('Página 1 de 3');expect(companies.mock.lastCall?.[0]).toMatchObject({filters:{search:'pet'},snapshotId:'partial-a'});expect(companies.mock.lastCall?.[0].cursor).toBeUndefined();
 await ui.click('Próxima página');await ui.click('Atualizar base');expect(ui.text()).toContain('Página 1 de 5');expect(ui.control('Pesquisar empresa').value).toBe('pet');expect(companies.mock.lastCall?.[0]).toMatchObject({filters:{search:'pet'},snapshotId:'partial-b',limit:20});expect(companies.mock.lastCall?.[0].cursor).toBeUndefined();
});
test('SEARCH-02 concise results keep a single subtitle total without competence or apply warning',async()=>{
 const ui=await show(<CompanySearchPage {...searchProps({readiness:async()=>partialSource('partial-a',53),companies:directoryPages(),domains})}/>);
 expect(ui.text().match(/53 empresas/g)).toHaveLength(1);expect(ui.host.querySelector('.prospecting-page > header')?.textContent).toContain('53 empresas');
 expect(ui.text()).not.toContain('Competência');expect(ui.host.querySelector('.prospecting-page h3')).toBeNull();await ui.fill('Pesquisar empresa','pet');expect(ui.text()).not.toContain('Aplique os filtros');
 const legacy=await show(<CompanySearchPage {...searchProps({companies:async()=>page(),domains})}/>);
 expect(legacy.host.querySelector('.prospecting-page > header')?.textContent).toContain('271 empresas');expect(legacy.host.querySelector('.prospecting-page h3')).toBeNull();
});
test('PRG-03 available partial companies enable search and CRM selection with an honest incomplete state',async()=>{
 const createProspects=vi.fn().mockResolvedValue({created:1,existing:0}),companies=vi.fn(async(q)=>({...page(),snapshotId:q.snapshotId??'partial-a',count:500}));
 const ui=await show(<CompanySearchPage {...searchProps({readiness:async()=>partialSource(),companies,domains,addProspects:createProspects})}/>);
 expect(ui.text()).toContain('Base em carga');expect(ui.text()).toContain('500 empresas disponíveis');expect(ui.text()).toContain('A cobertura ainda é parcial');
 expect(companies.mock.calls[0][0].snapshotId).toBe('partial-a');
 await ui.check('Selecionar '+first);expect(ui.button('Adicionar ao CRM').disabled).toBe(false);
 await ui.click('Adicionar ao CRM');expect(createProspects.mock.calls[0][0]).toMatchObject({snapshotId:'partial-a',cnpjs:[first]});
});
test('PRG-03 refresh preserves filters and cannot replace a selected partial view',async()=>{
 let finish!:(value:unknown)=>void;
 const readiness=vi.fn().mockResolvedValueOnce(partialSource()).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockRejectedValue(new Error('temporary'));
 const companies=vi.fn(async(q)=>({...page(),snapshotId:q.snapshotId??'partial-a',count:q.snapshotId==='partial-b'?2000:500,items:page().items.map(c=>({...c,uf:'SC'}))}));
 const lookup=async(q:CompanyDomainQuery)=>({items:q.kind==='municipios'?[{kind:'municipios',code:'8105',label:'FLORIANOPOLIS'}]:q.kind==='cnaes'?[{kind:'cnaes',code:'4781400',label:'Vestuário'}]:[],nextCursor:null});
 const ui=await show(<CompanySearchPage {...searchProps({readiness,companies,domains:lookup})}/>);
 await ui.fill('Pesquisar empresa','moda');await ui.fill('UF','SC');await pickDomain(ui,'Município','8105');await pickDomain(ui,'CNAE principal','4781400');await ui.click('Aplicar filtros');await ui.check('Selecionar '+first);
 expect(ui.button('Atualizar base').disabled).toBe(true);await ui.click('Atualizar base');expect(readiness).toHaveBeenCalledTimes(1);
 await ui.check('Selecionar '+first);await ui.click('Atualizar base');expect(ui.control('Pesquisar empresa').value).toBe('moda');expect(ui.control('UF').value).toBe('SC');
 await act(async()=>finish(partialSource('partial-b',2000)));
 expect(companies.mock.lastCall?.[0]).toMatchObject({snapshotId:'partial-b',filters:{search:'moda',ufs:['SC'],cityCodes:['8105'],mainCnaes:['4781400']}});
 expect(ui.control('Município').value).toContain('8105');expect(ui.control('CNAE principal').value).toContain('4781400');
 expect(ui.control('Pesquisar empresa').value).toBe('moda');expect(ui.control('UF').value).toBe('SC');expect(ui.text()).toContain('2.000 empresas disponíveis');
 await ui.click('Atualizar base');expect(ui.text()).toContain('Não foi possível atualizar a base');expect(ui.control('UF').value).toBe('SC');expect(ui.text()).toContain('Oficina '+first);
});
test('PRG-03 refresh blocks new selection until the updated view is ready',async()=>{
 let finish!:(value:unknown)=>void;
 const readiness=vi.fn().mockResolvedValueOnce(partialSource()).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const companies=async(q:{snapshotId?:string})=>({...page(),snapshotId:q.snapshotId??'partial-a'}),addProspects=vi.fn().mockResolvedValue({created:1,existing:0});
 const ui=await show(<CompanySearchPage {...searchProps({readiness,companies,domains,addProspects})}/>);
 await ui.click('Atualizar base');expect(ui.control('Selecionar '+first).disabled).toBe(true);
 await ui.check('Selecionar '+first);expect(ui.control('Selecionar '+first).checked).toBe(false);expect(ui.button('Adicionar ao CRM').disabled).toBe(true);
 await act(async()=>finish(partialSource('partial-b',2000)));
 expect(ui.text()).toContain('2.000 empresas disponíveis');expect(ui.control('Selecionar '+first).disabled).toBe(false);
 await ui.check('Selecionar '+first);expect(ui.button('Atualizar base').disabled).toBe(true);await ui.click('Adicionar ao CRM');
 expect(addProspects.mock.calls[0][0]).toMatchObject({snapshotId:'partial-b',cnpjs:[first]});
});

test('PRG-03 available companies remain selectable after their parent load is interrupted',async()=>{
 const source=partialSource();source.source.value.latestImport.state='failed';
 const ui=await show(<CompanySearchPage {...searchProps({readiness:async()=>source,companies:async()=>({...page(),snapshotId:'partial-a'}),domains})}/>);
 expect(ui.text()).toContain('Carga interrompida');expect(ui.text()).toContain('Os cadastros já liberados continuam disponíveis');
 await ui.check('Selecionar '+first);expect(ui.button('Adicionar ao CRM').disabled).toBe(false);
});
test("REC-03 storage failures show an interruption and retry actual readiness before mounting company search",async()=>{
  const job={id:'regional',state:'failed',phase:'failed',committedCount:57018146,selectedCompanies:0,validatedFiles:6,totalFiles:24,errorCode:'production_directory_storage_limit',updatedAt:'2026-11-23T05:57:06.812Z'};
  const readiness=vi.fn().mockResolvedValueOnce({source:{...preparing.source,value:{...preparing.source.value,latestImport:job}}}).mockResolvedValue(published);
  const companies=vi.fn().mockResolvedValue(page()),lookup=vi.fn(domains);
  const ui=await show(<CompanySearchPage {...searchProps({readiness,companies,domains:lookup})}/>);
  expect(ui.text()).toContain('Importação interrompida por armazenamento');expect(ui.host.querySelector('[role=alert]')?.textContent).toContain('A base ainda não foi publicada');
  expect(ui.text()).toContain('6 de 24 arquivos validados');expect(ui.text()).not.toContain('Base nacional em preparação');expect(companies).not.toHaveBeenCalled();expect(lookup).not.toHaveBeenCalled();
  await ui.click('Verificar disponibilidade');expect(ui.text()).toContain('Oficina '+first);expect(companies).toHaveBeenCalledTimes(1);
});
test("REC-03 real import progress shows staged selection and remains unavailable until publication",async()=>{
  const job={id:'regional',state:'importing',phase:'validating_sources',committedCount:0,selectedCompanies:54321,validatedFiles:3,totalFiles:23,errorCode:null,updatedAt:'2026-11-23T12:00:00Z'};
  const readiness=vi.fn().mockResolvedValue({source:{...preparing.source,value:{...preparing.source.value,latestImport:job}}}),companies=vi.fn(),lookup=vi.fn();
  const ui=await show(<CompanySearchPage {...searchProps({readiness,companies,domains:lookup})}/>);
  expect(ui.text()).toContain('Importando base de empresas');expect(ui.text()).toContain('3 de 23 arquivos validados');expect(ui.text()).toContain('54.321 empresas selecionadas');expect(ui.host.querySelector('[role=alert]')).toBeNull();
  await ui.click('Verificar disponibilidade');expect(readiness).toHaveBeenCalledTimes(2);expect(companies).not.toHaveBeenCalled();expect(lookup).not.toHaveBeenCalled();
});
test("REC-03 published regional coverage includes Floripa in SC and preserves city and retail filters",async()=>{
  const readiness=async()=>({source:{...published.source,value:{...published.source.value,coverage:regionalCoverage}}}),companies=vi.fn().mockResolvedValue(page());
  const lookup=async(q:{kind:string})=>({items:q.kind==='municipios'?[{kind:'municipios',code:'8105',label:'FLORIANOPOLIS'}]:q.kind==='cnaes'?[{kind:'cnaes',code:'4781400',label:'Vestuário'}]:[],nextCursor:null});
  const ui=await show(<CompanySearchPage {...searchProps({readiness,companies,domains:lookup})}/>);
  expect(ui.text()).toContain('Varejo do Sudeste e Sul');expect(ui.text()).toContain('12.345 empresas ativas com telefone');expect(ui.text()).toContain('limite da base de 25 GB');
  expect(Array.from(ui.control('UF').querySelectorAll('option')).map(o=>o.value)).toEqual(['',...regionalCoverage.ufs]);
  expect(ui.control('Simples Nacional').disabled).toBe(true);expect(ui.control('MEI').disabled).toBe(true);
  await ui.fill('UF','SC');await pickDomain(ui,'Município','8105');await pickDomain(ui,'CNAE principal','4781400');await ui.click('Aplicar filtros');
  expect(companies.mock.lastCall?.[0].filters).toEqual({ufs:['SC'],cityCodes:['8105'],mainCnaes:['4781400']});
});
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
  expect(ui.host.querySelector('#save-company-search')).toBeNull();
  await ui.click("Salvar busca");
  expect(ui.text()).toContain("Guarde estes filtros para escolher o mesmo público ao criar uma campanha.");
  await ui.fill("Nome da busca", "Oficinas");
  await ui.click("Salvar");
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
  await pickDomain(ui,"Município", "6001");
  expect(ui.control("Município").value).toBe("Santa Cruz · 6001");
  await ui.fill("UF", "SP");
  expect(ui.control("Município").value).toBe("");
  await pickDomain(ui,"Município", "7107");
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
  await pickDomain(ui,'CNAE principal','4711301');
  expect(ui.control('CNAE principal').value).toBe('Atividade oficial · 4711301');
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
