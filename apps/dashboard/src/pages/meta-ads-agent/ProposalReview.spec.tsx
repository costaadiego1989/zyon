// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import type { MetaAdsAgentApi } from "../../api/endpoints/meta-ads-agent.js";
import { DashboardHttpError } from "../../api/http/error.js";
import { ProposalReview } from "./ProposalReview.js";
import { proposal } from "./fixtures.js";
import { ui } from "./test-helpers.js";
let screen: ReturnType<typeof ui>;
afterEach(async () => screen?.close());

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
