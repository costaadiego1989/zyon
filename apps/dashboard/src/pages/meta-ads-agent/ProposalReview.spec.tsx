// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import type { MetaAdsAgentApi } from "../../api/endpoints/meta-ads-agent.js";
import { DashboardHttpError } from "../../api/http/error.js";
import { ProposalReview } from "./ProposalReview.js";
import { proposal } from "./fixtures.js";
import { ui } from "./test-helpers.js";
let screen: ReturnType<typeof ui>;
afterEach(async () => screen?.close());

test('APU-01 publication review shows a short Portuguese summary instead of raw Meta configuration',async()=>{
 screen=ui();const p=proposal();p.before={status:'PAUSED',budget:{lifetime_budget:'1000'},objects:[{type:'campaign',id:'120250883547060637'},{type:'ad_set',id:'120250883547880637'},{type:'ad',id:'120250883551670637'}],targeting:{age_min:18,age_max:65,age_range:[18,65],geo_locations:{countries:['BR'],location_types:['home','recent']},effective_publisher_platforms:['facebook','instagram','whatsapp','threads'],page_types:Array(60).fill('instagramstream'),targeting_automation:{advantage_audience:1},targeting_optimization:'expansion_all',provider_new_field:'private_enum'},objectStates:[{type:'ad',id:'120250883551670637',status:'ACTIVE',effectiveStatus:'CAMPAIGN_PAUSED'}]};
 p.after={status:'ACTIVE',budget:{amountCents:1000,currency:'BRL',cadence:'lifetime'},objects:p.before.objects};
 await screen.render(<ProposalReview proposal={p} entitled connectionEpoch={1} api={{} as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
 const text=screen.container.textContent!;expect(text).toContain('Antes');expect(text).toContain('Proposto');expect(text).toContain('Pausado');expect(text).toContain('Ativo');expect(text).toContain('Brasil');expect(text).toContain('A partir de 18 anos');expect(text).toContain('Facebook, Instagram, WhatsApp e Threads');
 for(const raw of ['age max','age range','page types','instagramstream','expansion_all','provider_new_field','private_enum','ad_set'])expect(text).not.toContain(raw);
 const references=screen.container.querySelector('details[data-meta-references]') as HTMLDetailsElement;expect(references.open).toBe(false);expect(references.textContent).toContain('120250883547060637');
 expect(screen.container.querySelector('[data-proposal-scope]')?.textContent).toContain('1 campanha');expect(screen.container.querySelector('[data-proposal-scope]')?.textContent).toContain('1 conjunto de anúncios');expect(screen.container.querySelector('[data-proposal-scope]')?.textContent).toContain('1 anúncio');
 expect(screen.container.querySelector('header')?.textContent).not.toContain(p.campaignId);expect((screen.container.querySelector('[data-action="approve"]') as HTMLButtonElement).disabled).toBe(true);
});

test('APU-02 budget and creative changes keep exact commercial content visible before approval',async()=>{
 screen=ui();const p={...proposal(),kind:'creative' as const,before:{status:'PAUSED',budget:{daily_budget:'1000'}},after:{budget:{amountCents:2000,currency:'BRL',cadence:'daily',startsAt:'2026-11-23T19:50:00Z',endsAt:'2026-11-24T19:50:00Z'},headline:'Bluetooth no seu PC',primaryText:'Confira os requisitos antes de comprar.',media:[{url:'https://images.example.test/ub500.png'}],products:[{name:'Adaptador UB500',sku:'ATHOM-UB500',priceCents:6990,currency:'BRL'}],country:'BR'}};
 await screen.render(<ProposalReview proposal={p} entitled connectionEpoch={1} api={{} as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
 const text=screen.container.textContent!;for(const value of ['10,00','20,00','por dia','23/11/2026','24/11/2026','Bluetooth no seu PC','Confira os requisitos antes de comprar.','Adaptador UB500','69,90','Brasil'])expect(text).toContain(value);
 expect(screen.container.querySelector('img')?.getAttribute('src')).toBe('https://images.example.test/ub500.png');expect((screen.container.querySelector('[data-action="approve"]') as HTMLButtonElement).disabled).toBe(true);
 const [before,after]=Array.from(screen.container.querySelectorAll('.mga-comparison > section'));expect(before.textContent).toContain('10,00');expect(before.textContent).toContain('por dia');expect(after.textContent).toContain('20,00');expect(after.textContent).toContain('por dia');expect(after.textContent).not.toContain('No total do período');
});

test('APU-03 unrecognized provider fields and states never become English UI labels',async()=>{
 screen=ui();const p=proposal();p.before={status:'FUTURE_REMOTE_STATE',unknown_provider_key:{unknown_enum:'SOME_INTERNAL_FLAG'}};
 await screen.render(<ProposalReview proposal={p} entitled connectionEpoch={1} api={{} as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
 for(const raw of ['FUTURE_REMOTE_STATE','unknown_provider_key','unknown enum','SOME_INTERNAL_FLAG'])expect(screen.container.textContent).not.toContain(raw);
 expect(screen.container.textContent).toContain('Não informado');
});

test('APU-04 Meta reference disclosure opens and closes without approving or executing',async()=>{
 screen=ui();const api={approve:vi.fn(),execute:vi.fn()};
 await screen.render(<ProposalReview proposal={proposal()} entitled connectionEpoch={1} api={api as unknown as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
 const details=screen.container.querySelector('details[data-meta-references]') as HTMLDetailsElement;
 const summary=details.querySelector('summary')!;expect(details.open).toBe(false);
 await import('react').then(({act})=>act(async()=>summary.click()));expect(details.open).toBe(true);expect(details.textContent).toContain('999');
 await import('react').then(({act})=>act(async()=>summary.click()));expect(details.open).toBe(false);
 expect(api.approve).not.toHaveBeenCalled();expect(api.execute).not.toHaveBeenCalled();
});

test('APU-05 daily and lifetime cadence are verified in their own comparison columns',async()=>{
 screen=ui();const p=proposal();p.before={budget:{daily_budget:'1000'}};p.after={budget:{amountCents:2000,currency:'BRL',cadence:'lifetime',startsAt:'2026-11-23T19:50:00Z',endsAt:'2026-11-24T19:50:00Z'}};
 await screen.render(<ProposalReview proposal={p} entitled connectionEpoch={1} api={{} as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
 const [before,after]=Array.from(screen.container.querySelectorAll('.mga-comparison > section'));
 expect(before.textContent).toContain('10,00');expect(before.textContent).toContain('por dia');expect(before.textContent).not.toContain('No total do período');
 expect(after.textContent).toContain('20,00');expect(after.textContent).toContain('No total do período');expect(after.textContent).not.toContain('por dia');expect(after.textContent).toContain('23/11/2026');expect(after.textContent).toContain('24/11/2026');
});

test('APU-06 audience summaries retain gender and region without inventing unchanged restrictions',async()=>{
 screen=ui();for(const kind of ['publish','audience'] as const){const p=proposal();p.kind=kind;const targeting={age_min:26,age_max:54,genders:[2],geo_locations:{countries:['BR'],regions:[{key:'3844',name:'São Paulo'}]}};
 p.before={status:'PAUSED',targeting};p.after=kind==='publish'?{status:'ACTIVE'}:{targeting:{...targeting,geo_locations:{countries:['PT']}}};
 await screen.render(<ProposalReview proposal={p} entitled connectionEpoch={1} api={{} as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
 const [before,after]=Array.from(screen.container.querySelectorAll('.mga-comparison > section'));
 expect(before.textContent).toContain('Brasil');expect(before.textContent).toContain('De 26 a 54 anos');expect(before.textContent).toContain('Mulheres');expect(before.textContent).toContain('São Paulo');
 expect(after.textContent).toContain('Mulheres');expect(after.textContent).toContain(kind==='publish'?'Brasil':'Portugal');
 if(kind==='publish')expect(after.textContent).toContain('São Paulo');else expect(after.textContent).not.toContain('São Paulo');}
});

test('APU-07 one Meta creative with three media is never called one image',async()=>{
 screen=ui();const p=proposal();p.kind='prepare';p.after={objects:[{type:'campaign',id:'200'},{type:'ad_set',id:'300'},{type:'creative',id:'400'},{type:'ad',id:'500'}],media:[1,2,3].map(n=>({url:`https://images.example.test/${n}.png`}))};
 await screen.render(<ProposalReview proposal={p} entitled connectionEpoch={1} api={{} as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
 expect(screen.container.querySelectorAll('img')).toHaveLength(3);expect(screen.container.querySelector('[data-proposal-scope]')?.textContent).not.toContain('1 imagem');expect(screen.container.textContent).not.toContain('1 imagem do anúncio');
 expect(screen.container.querySelector('[data-meta-references]')?.textContent).toContain('Material do anúncio');expect(screen.container.querySelector('[data-meta-references]')?.textContent).toContain('400');
});

test('APU-08 remote zero daily plus lifetime budget stays total in its own column',async()=>{
 screen=ui();const p=proposal();p.before={budget:{daily_budget:'0',lifetime_budget:'1000'}};p.after={budget:{amountCents:2000,currency:'BRL',cadence:'daily'}};
 await screen.render(<ProposalReview proposal={p} entitled connectionEpoch={1} api={{} as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
 const [before,after]=Array.from(screen.container.querySelectorAll('.mga-comparison > section'));expect(before.textContent).toContain('10,00');expect(before.textContent).toContain('No total do período');expect(before.textContent).not.toContain('por dia');expect(after.textContent).toContain('20,00');expect(after.textContent).toContain('por dia');expect(after.textContent).not.toContain('No total do período');
});

test('APU-09 a receipt without new objects retains one closed list of the known Meta references',async()=>{
 screen=ui();const p={...proposal(),status:'approved' as const};const execution={id:'exec1',proposalId:p.id,campaignId:p.campaignId,status:'execution_unknown' as const,objects:[],error:'timeout',updatedAt:'2026-11-23T20:00:00Z'};
 await screen.render(<ProposalReview proposal={p} execution={execution} entitled connectionEpoch={1} api={{} as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
 const references=screen.container.querySelectorAll('details[data-meta-references]');expect(references).toHaveLength(1);expect((references[0] as HTMLDetailsElement).open).toBe(false);expect(references[0].textContent).toContain('999');expect(screen.container.textContent).not.toContain('Executar alteração aprovada');
});

test("ADAS-72 an equivalent refresh preserves the reviewed acknowledgement and approves the exact version", async () => {
  screen = ui(); const p = proposal(); const approve = vi.fn().mockResolvedValue({...p, status:"approved"});
  const props = {entitled:true, connectionEpoch:1, api:{approve} as unknown as MetaAdsAgentApi, onUpdated:vi.fn()};
  await screen.render(<ProposalReview {...props} proposal={p}/>);
  await import("react").then(({act}) => act(async () => {(screen.container.querySelector('input[type="checkbox"]') as HTMLInputElement).click();}));
  await screen.render(<ProposalReview {...props} proposal={structuredClone(p)}/>);
  expect((screen.container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
  expect((screen.container.querySelector('button[data-action="approve"]') as HTMLButtonElement).disabled).toBe(false);
  await screen.click("Aprovar publicação"); expect(approve).toHaveBeenCalledWith(p.id,p.digest);
  expect(screen.container.textContent).toContain("Aprovação registrada");
});

test("ADAS-72 changed identity digest reviewed content or effective connection clears acknowledgement", async () => {
  screen = ui(); const p = proposal(); const props={entitled:true,connectionEpoch:1,api:{} as MetaAdsAgentApi,onUpdated:vi.fn()};
  const changes = [{proposal:{...p,id:'another-proposal'}},{proposal:{...p,digest:'another-digest'}},{proposal:{...p,after:{...p.after,budget:{amountCents:9000,currency:'BRL',cadence:'daily'}}}},{proposal:{...p,reasoning:'Outro motivo revisado'}},{proposal:p,connectionEpoch:2}];
  for(const change of changes){
    await screen.render(<ProposalReview {...props} proposal={p}/>);
    await import("react").then(({act}) => act(async () => {(screen.container.querySelector('input[type="checkbox"]') as HTMLInputElement).click();}));
    expect((screen.container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
    await screen.render(<ProposalReview {...props} {...change}/>);
    const checkbox=screen.container.querySelector('input[type="checkbox"]') as HTMLInputElement|null;
    expect(checkbox?.checked??false).toBe(false);
    expect((screen.container.querySelector('button[data-action="approve"]') as HTMLButtonElement|null)?.disabled??true).toBe(true);
  }
});

test("ADAS-72 database key ordering retains the same reviewed content and acknowledgement", async () => {
  screen = ui(); const p=proposal(); const props={entitled:true,connectionEpoch:1,api:{} as MetaAdsAgentApi,onUpdated:vi.fn()};
  await screen.render(<ProposalReview {...props} proposal={p}/>);
  await import("react").then(({act})=>act(async()=>{(screen.container.querySelector('input[type="checkbox"]') as HTMLInputElement).click();}));
  const budget=Object.fromEntries(Object.entries(p.after.budget as Record<string,unknown>).reverse());
  const after=Object.fromEntries(Object.entries({...p.after,budget}).reverse());
  await screen.render(<ProposalReview {...props} proposal={{...p,after}}/>);
  expect((screen.container.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(true);
  expect((screen.container.querySelector('button[data-action="approve"]') as HTMLButtonElement).disabled).toBe(false);
});
test("MGA-39 before/after and affected objects precede approval; rejection never executes", async () => {
  screen = ui(); const p = proposal(); p.kind = "budget"; p.before = {objects: [{type: "campaign", id: "999"}], budget: {daily_budget: "1000"}};
  const reject = vi.fn().mockResolvedValue({...p, status: "rejected"}), execute = vi.fn();
  await screen.render(<ProposalReview proposal={p} entitled connectionEpoch={1} api={{reject, execute} as unknown as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
  expect(screen.container.textContent).toContain("Antes"); expect(screen.container.textContent).toContain("Proposto");
  expect(screen.container.textContent).toContain("10,00"); expect(screen.container.textContent).toContain("20,00"); expect(screen.container.textContent).toContain("999");
  await screen.click("Rejeitar proposta"); expect(screen.container.textContent).toContain("Proposta rejeitada"); expect(execute).not.toHaveBeenCalled();
});
test("MGA-43 publication requires explicit budget acknowledgement and separate reviewed approval", async () => {
  screen = ui(); const p = proposal(); const approve = vi.fn().mockResolvedValue({...p, status: "approved", approvedBy: "merchant", approvedAt: "2026-11-15"}); const execute = vi.fn().mockResolvedValue({id: "exec1", proposalId: p.id, campaignId: p.campaignId, status: "publishing", objects: [{type: "campaign", id: "999"}], error: null});
  await screen.render(<ProposalReview proposal={p} entitled connectionEpoch={1} api={{approve, execute} as unknown as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
  const approval = screen.container.querySelector('button[data-action="approve"]') as HTMLButtonElement;
  expect(approval.disabled).toBe(true); expect(screen.container.textContent).toContain("20,00");
  const checkbox = screen.container.querySelector('input[type="checkbox"]') as HTMLInputElement; await import("react").then(({act}) => act(async () => {checkbox.click();}));
  await screen.click("Aprovar publicação"); expect(approve).toHaveBeenCalledWith(p.id, "digest1"); expect(execute).not.toHaveBeenCalled();
  await screen.click("Executar alteração aprovada"); expect(screen.container.textContent).toContain("Publicação em processamento"); expect(screen.container.textContent).not.toContain("Veiculação confirmada");
});
test("unknown execution prevents resend and reconciliation changes only the displayed result", async () => {
  screen = ui(); const p = {...proposal(), status: "approved" as const}; const execution = {id: "e1", proposalId: p.id, campaignId: p.campaignId, status: "execution_unknown" as const, objects: [], error: "timeout", updatedAt: "2026-11-15"}; const execute = vi.fn(); const reconcile = vi.fn().mockResolvedValue({...execution, status: "active_unconfirmed"});
  await screen.render(<ProposalReview proposal={p} execution={execution} entitled={false} connectionEpoch={1} api={{execute, reconcile} as unknown as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
  expect(screen.container.textContent).toContain("Resultado desconhecido"); expect(screen.container.textContent).not.toContain("Executar alteração aprovada");
  await screen.click("Consultar estado na Meta"); expect(screen.container.textContent).toContain("veiculação ainda não confirmada"); expect(execute).not.toHaveBeenCalled();
});
test("lost execution response requires refreshing history before another execution gesture", async () => {
  screen = ui(); const execute = vi.fn().mockRejectedValue(new Error("network_lost"));
  await screen.render(<ProposalReview proposal={{...proposal(), status: "approved"}} entitled connectionEpoch={1} api={{execute} as unknown as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
  await screen.click("Executar alteração aprovada");
  expect(screen.container.textContent).toContain("Resultado desconhecido");
  expect(screen.container.textContent).not.toContain("Executar alteração aprovada");
  expect(execute).toHaveBeenCalledTimes(1);
});
test("paused preparation shows ready without delivery and still requires a separate publication", async () => {
  screen = ui(); const p = {...proposal(), kind: "prepare" as const, status: "executed" as const};
  await screen.render(<ProposalReview proposal={p} execution={{id:"e1",proposalId:p.id,campaignId:p.campaignId,status:"remote_paused",objects:[],error:null,updatedAt:"2026-11-15"}} entitled connectionEpoch={1} api={{} as MetaAdsAgentApi} onUpdated={vi.fn()}/>);
  expect(screen.container.textContent).toContain("Preparada, sem veiculação");
  expect(screen.container.textContent).toContain("A publicação terá sua própria aprovação");
  expect(screen.container.textContent).not.toContain("Veiculação confirmada");
});
test("confirmed stale rejection asks for new review instead of claiming an unknown provider outcome", async () => {
  screen = ui(); const updated = vi.fn(); const execute = vi.fn().mockRejectedValue(new DashboardHttpError(409,'{"code":"proposal_stale"}'));
  await screen.render(<ProposalReview proposal={{...proposal(), status:"approved"}} entitled connectionEpoch={1} api={{execute} as unknown as MetaAdsAgentApi} onUpdated={updated}/>);
  await screen.click("Executar alteração aprovada");
  expect(screen.container.textContent).toContain("Proposta desatualizada");
  expect(screen.container.textContent).not.toContain("Resultado desconhecido");
  expect(screen.container.textContent).not.toContain("Executar alteração aprovada"); expect(updated).toHaveBeenCalledTimes(1);
});
