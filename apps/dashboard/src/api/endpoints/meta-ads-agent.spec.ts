import { expect, test, vi } from "vitest";
import { metaAdsAgentEndpoints } from "./meta-ads-agent.js";

test("authenticated module routes preserve approval digest and return uncertain execution without retry", async () => {
  const calls: Array<{url: string; init?: RequestInit}> = [];
  const f = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({url: String(url), init});
    return new Response(JSON.stringify({ id: "e1", status: "execution_unknown" }));
  });
  const api = metaAdsAgentEndpoints("https://api.example.test", f as typeof fetch);
  await api.approve("p1", "reviewed-digest");
  expect(calls[0].url).toBe("https://api.example.test/v1/meta-ads-agent/proposals/p1/approve");
  expect(calls[0].init?.credentials).toBe("include");
  expect(JSON.parse(calls[0].init!.body as string)).toEqual({ digest: "reviewed-digest" });
  expect((await api.execute("p1")).status).toBe("execution_unknown");
  expect(calls).toHaveLength(2);
  expect(JSON.parse(calls[1].init!.body as string)).toEqual({});
});
test("checkout keeps accepted offer version and explicit request identity; products safely encode query", async () => {
  const f = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response("{}"));
  const api = metaAdsAgentEndpoints("https://api.example.test", f as typeof fetch);
  await api.checkout({kind: "extra_images", idempotencyKey: "purchase-one", offerVersion: "v1"});
  expect(JSON.parse(f.mock.calls[0][1]!.body as string)).toEqual({kind: "extra_images", idempotencyKey: "purchase-one", offerVersion: "v1"});
  await api.products("sapato & bolsa");
  expect(String(f.mock.calls[1][0])).toBe("https://api.example.test/v1/meta-ads-agent/products?query=sapato+%26+bolsa");
});
test("provider rejection and network failure stay errors and never resend a write", async () => {
  const rejected = vi.fn(async () => new Response('{"code":"proposal_stale"}', { status: 409 }));
  await expect(metaAdsAgentEndpoints("https://api.example.test", rejected as typeof fetch).execute("p1")).rejects.toMatchObject({status: 409, responseBody: '{"code":"proposal_stale"}'});
  expect(rejected).toHaveBeenCalledTimes(1);
  const lost = vi.fn(async () => {throw new Error("offline");});
  await expect(metaAdsAgentEndpoints("https://api.example.test", lost as typeof fetch).execute("p1")).rejects.toMatchObject({status: 0});
  expect(lost).toHaveBeenCalledTimes(1);
});

function workspaceClient(response:unknown={}){const calls:Array<{url:string;init:RequestInit}>=[];const api=metaAdsAgentEndpoints('https://api.example.test',async(url,init)=>{calls.push({url:String(url),init:init??{}});return new Response(JSON.stringify(response));});return{api,calls};}
test('workspace client preserves the complete encoded campaign query and authenticated transport',async()=>{const f=workspaceClient({items:[],counts:{all:0}});await f.api.workspace({filter:'approval',search:'áudio & casa',page:2,since:'2026-11-01',until:'2026-11-22'});expect(f.calls[0].url).toBe('https://api.example.test/v1/meta-ads-agent/campaign-workspace?filter=approval&search=%C3%A1udio+%26+casa&page=2&since=2026-11-01&until=2026-11-22');expect(f.calls[0].init.credentials).toBe('include');expect(f.calls[0].init.method).toBe('GET');});
test('workspace client opens one encoded campaign detail in the same report period',async()=>{const f=workspaceClient();await f.api.workspaceDetail('campaign/a',{since:'2026-11-01',until:'2026-11-22'});expect(f.calls[0].url).toBe('https://api.example.test/v1/meta-ads-agent/campaign-workspace/campaign%2Fa?since=2026-11-01&until=2026-11-22');});
test('workspace client forwards the context cancellation signal to reads',async()=>{const f=workspaceClient(),controller=new AbortController();await f.api.workspace({},controller.signal);await f.api.campaignSales('c1',{since:'2026-11-01',until:'2026-11-22'},controller.signal);expect(f.calls.every(c=>c.init.signal===controller.signal)).toBe(true);controller.abort();expect(f.calls[0].init.signal?.aborted).toBe(true);});
test('workspace client deletes only with the reviewed version and stable request identity',async()=>{const f=workspaceClient({lifecycle:{state:'deleted_draft'}});const value=await f.api.deleteDraft('c1',{expectedVersion:3,idempotencyKey:'delete-a'});expect(value.lifecycle?.state).toBe('deleted_draft');expect(f.calls[0].url).toMatch(/campaigns\/c1\/delete-draft$/);expect(f.calls[0].init.method).toBe('POST');expect(JSON.parse(String(f.calls[0].init.body))).toEqual({expectedVersion:3,idempotencyKey:'delete-a'});});
test('workspace client archive has a dedicated request and does not call provider delete',async()=>{const f=workspaceClient();await f.api.archiveCampaign('c1',{expectedVersion:0,idempotencyKey:'archive-a'});expect(f.calls).toHaveLength(1);expect(f.calls[0].url).toMatch(/campaigns\/c1\/archive$/);expect(f.calls[0].init.method).toBe('POST');});
test('workspace client updates quantity limits without adding financial policy or extras',async()=>{const f=workspaceClient();await f.api.preparationLimits();await f.api.savePreparationLimits({dailyNewProposals:0,maximumPendingProposals:2,expectedVersion:1});expect(f.calls[0].url).toMatch(/preparation-limits$/);expect(f.calls[1].init.method).toBe('PUT');expect(JSON.parse(String(f.calls[1].init.body))).toEqual({dailyNewProposals:0,maximumPendingProposals:2,expectedVersion:1});});
test('workspace client sales pages and order origin retain period and canonical identifier',async()=>{const f=workspaceClient();await f.api.campaignSales('c1',{since:'2026-11-01',until:'2026-11-22',page:2});await f.api.orderAdOrigin('order /a');expect(f.calls[0].url).toMatch(/campaigns\/c1\/sales\?since=2026-11-01&until=2026-11-22&page=2$/);expect(f.calls[1].url).toMatch(/orders\/order%20%2Fa\/ad-origin$/);expect(f.calls.every(c=>c.init.method==='GET')).toBe(true);});
test('workspace client exposes lifecycle conflicts without retrying or inventing success',async()=>{let count=0;const api=metaAdsAgentEndpoints('https://api.example.test',async()=>{count++;return new Response('{"code":"campaign_version_conflict"}',{status:409});});await expect(api.deleteDraft('c1',{expectedVersion:0,idempotencyKey:'delete-a'})).rejects.toMatchObject({status:409,responseBody:'{"code":"campaign_version_conflict"}'});expect(count).toBe(1);});
