import { expect, test, vi } from 'vitest';
import { merchantAssistantEndpoints } from './merchant-assistant.js';

const input = { message: 'Quero anunciar', idempotencyKey: 'turn-one', expectedRevision: 0 };
test('ADAS-10 typed conversation transport sends only user input with authenticated cookies', async () => {
  const f = vi.fn(async () => new Response(JSON.stringify({ turn: { id: 'one', status: 'queued' }, revision: 1, replayed: false })));
  const api = merchantAssistantEndpoints('https://api.example.test', f as typeof fetch);
  const result = await api.submit('meta-ads', 'thread/one', { ...input, actorId: 'intruder', accountId: 'foreign' } as typeof input);
  const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe('https://api.example.test/v1/merchant-assistant/contexts/meta-ads/threads/thread%2Fone/turns');
  expect(init.credentials).toBe('include'); expect(JSON.parse(init.body as string)).toEqual(input); expect(result.turn.id).toBe('one');
});
test('ADAS-11 thread history sources and reports use scoped encoded read routes', async () => {
  const f = vi.fn(async () => new Response('{}')); const api = merchantAssistantEndpoints('https://api.example.test', f as typeof fetch);
  await api.thread('meta-ads'); await api.page('meta-ads', 't', '21'); await api.source('meta-ads', 'funds:one'); await api.reports(); await api.report('day/one');
  expect(f.mock.calls.map(c => String((c as unknown[])[0]))).toEqual([
    'https://api.example.test/v1/merchant-assistant/contexts/meta-ads/thread',
    'https://api.example.test/v1/merchant-assistant/contexts/meta-ads/threads/t/turns?before=21',
    'https://api.example.test/v1/merchant-assistant/contexts/meta-ads/sources/funds%3Aone',
    'https://api.example.test/v1/meta-ads-agent/reports', 'https://api.example.test/v1/meta-ads-agent/reports/day%2Fone',
  ]);
});
test('ADAS-14 retry preserves durable body and HTTP request identity without automatic mutation replay', async () => {
  const f = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(new Response('{}'));
  const api = merchantAssistantEndpoints('https://api.example.test', f as typeof fetch);
  await expect(api.submit('meta-ads', 't', input)).rejects.toMatchObject({status: 0}); await api.submit('meta-ads', 't', input);
  expect(f).toHaveBeenCalledTimes(2);
  for (const call of f.mock.calls) { expect(JSON.parse(call[1].body)).toEqual(input); expect(new Headers(call[1].headers).get('Idempotency-Key')).toBe('turn-one'); }
});
test('ADAS-12 disposing a store client aborts requests and discards an ignored late response', async () => {
  let resolve!: (r: Response) => void; let signal: AbortSignal | undefined;
  const f = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => { signal = init?.signal ?? undefined; return new Promise<Response>(yes => { resolve = yes; }); });
  const api = merchantAssistantEndpoints('https://api.example.test', f as typeof fetch); const pending = api.thread('meta-ads');
  api.dispose(); expect(signal?.aborted).toBe(true); resolve(new Response('{"id":"old-private-history"}'));
  await expect(pending).rejects.toMatchObject({name: 'AbortError'}); await expect(api.thread('meta-ads')).rejects.toMatchObject({name: 'AbortError'}); expect(f).toHaveBeenCalledTimes(1);
});
test('ADAS-48 caller cancellation and HTTP scope errors stay actionable and do not retry', async () => {
  const f = vi.fn(async () => new Response('{"code":"assistant_forbidden"}', {status:403}));
  const api = merchantAssistantEndpoints('https://api.example.test', f as typeof fetch);
  await expect(api.thread('meta-ads')).rejects.toMatchObject({status:403, responseBody:'{"code":"assistant_forbidden"}'});
  const controller = new AbortController(); controller.abort(); await expect(api.thread('meta-ads', controller.signal)).rejects.toMatchObject({name:'AbortError'}); expect(f).toHaveBeenCalledTimes(1);
});
test('ADAS-33 funding refresh and policy writes preserve exact reviewed terms and version', async () => {
  const f = vi.fn(async () => new Response('{}')); const api = merchantAssistantEndpoints('https://api.example.test', f as typeof fetch);
  await api.funding(); await api.refreshFunding(); await api.automation();
  const terms = {scope:{variantIds:['one'],campaignIds:[],allowNewCampaigns:true,destination:'store',priority:'paid_sales',country:'BR',actions:['pause']},limits:{currency:'BRL',cadence:'lifetime',campaignCeilingCents:10000,storeCeilingCents:20000,startsAt:'2026-11-16T12:00:00Z',endsAt:'2026-11-23T12:00:00Z'}} as const;
  const review = {...terms, scope:{...terms.scope,variantIds:['one'],campaignIds:[],actions:['pause' as const]},version:1,digest:'reviewed',idempotencyKey:'accept-one'};
  await api.reviewAutomation(review); await api.acceptAutomation(review); await api.manual({policyId:'p',version:1,idempotencyKey:'revoke-one'});
  const calls=f.mock.calls as unknown as Array<[string,RequestInit]>;
  expect(calls[1][0]).toContain('/funding/refresh'); expect(JSON.parse(calls[1][1].body as string)).toEqual({});
  expect(JSON.parse(calls[3][1].body as string)).toEqual(terms); expect(JSON.parse(calls[4][1].body as string)).toEqual(review); expect(new Headers(calls[4][1].headers).get('Idempotency-Key')).toBe('accept-one');
  expect(JSON.parse(calls[5][1].body as string)).toEqual({policyId:'p',version:1,idempotencyKey:'revoke-one'});
});
