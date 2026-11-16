import type { AssistantThread, AssistantTurn, AssistantTurnInput, MetaAdsAutomationPolicyInput, MetaAdsAutomationReview, MetaAdsAutomationState, MetaAdsDailyReport, MetaAdsFundingDiagnosis } from '@zyon/shared-types';
import { dashboardJson } from '../http/client.js';

export interface AssistantSourceView {
  id: string; version: string; title: string; url: string; reviewedAt: string;
  sections: Array<{ id: string; content: string }>;
  externalSources: Array<{title: string; url: string}>;
}
export type AutomationView = MetaAdsAutomationState & {version: number};
export type AcceptAutomationInput = MetaAdsAutomationPolicyInput & {version: number; digest: string; idempotencyKey: string};
const aborted = () => new DOMException('Contexto encerrado', 'AbortError');
/** One mounted store owns one instance; dispose it before switching store. */
export function merchantAssistantEndpoints(base: string, f: typeof fetch = globalThis.fetch) {
  const pending = new Set<AbortController>(); let disposed = false;
  async function request<T>(path: string, body?: unknown, signal?: AbortSignal, key?: string): Promise<T> {
    if (disposed || signal?.aborted) throw aborted();
    const controller = new AbortController(); pending.add(controller);
    const cancel = () => controller.abort(); signal?.addEventListener('abort', cancel, {once:true});
    try {
      const result = await dashboardJson<T>(base, path, {method:body === undefined ? 'GET' : 'POST', ...(body === undefined ? {} : {jsonBody:body}), signal:controller.signal, ...(key ? {headers:{'Idempotency-Key':key}} : {})}, f);
      if (disposed || controller.signal.aborted) throw aborted(); return result;
    } catch (error) { if (disposed || controller.signal.aborted) throw aborted(); throw error; }
    finally { pending.delete(controller); signal?.removeEventListener('abort',cancel); }
  }
  const contextPath = (context: string) => `/merchant-assistant/contexts/${encodeURIComponent(context)}`;
  const terms = (input: MetaAdsAutomationPolicyInput) => ({scope:input.scope,limits:input.limits});
  return {
    dispose() { disposed = true; for (const controller of pending) controller.abort(); pending.clear(); },
    thread: (context: string, signal?: AbortSignal) => request<AssistantThread>(`${contextPath(context)}/thread`,undefined,signal),
    page: (context: string, thread: string, before?: string, signal?: AbortSignal) => request<AssistantThread>(`${contextPath(context)}/threads/${encodeURIComponent(thread)}/turns${before ? `?${new URLSearchParams({before})}` : ''}`,undefined,signal),
    submit: (context: string, thread: string, input: AssistantTurnInput, signal?: AbortSignal) => request<{turn:AssistantTurn;revision:number;replayed:boolean}>(`${contextPath(context)}/threads/${encodeURIComponent(thread)}/turns`,{message:input.message,idempotencyKey:input.idempotencyKey,expectedRevision:input.expectedRevision},signal,input.idempotencyKey),
    source: (context: string, id: string, signal?: AbortSignal) => request<AssistantSourceView>(`${contextPath(context)}/sources/${encodeURIComponent(id)}`,undefined,signal),
    funding: (signal?: AbortSignal) => request<MetaAdsFundingDiagnosis>('/meta-ads-agent/funding',undefined,signal),
    refreshFunding: (signal?: AbortSignal) => request<MetaAdsFundingDiagnosis>('/meta-ads-agent/funding/refresh',{},signal),
    automation: (signal?: AbortSignal) => request<AutomationView>('/meta-ads-agent/automation',undefined,signal),
    reviewAutomation: (input: MetaAdsAutomationPolicyInput, signal?: AbortSignal) => request<MetaAdsAutomationReview>('/meta-ads-agent/automation/review',terms(input),signal),
    acceptAutomation: (input: AcceptAutomationInput, signal?: AbortSignal) => request<MetaAdsAutomationState>('/meta-ads-agent/automation/accept',{...terms(input),version:input.version,digest:input.digest,idempotencyKey:input.idempotencyKey},signal,input.idempotencyKey),
    manual: (input: {policyId:string;version:number;idempotencyKey:string}, signal?: AbortSignal) => request<MetaAdsAutomationState>('/meta-ads-agent/automation/manual',{policyId:input.policyId,version:input.version,idempotencyKey:input.idempotencyKey},signal,input.idempotencyKey),
    reports: (signal?: AbortSignal) => request<{reports:MetaAdsDailyReport[]}>('/meta-ads-agent/reports',undefined,signal),
    report: (id: string, signal?: AbortSignal) => request<MetaAdsDailyReport>(`/meta-ads-agent/reports/${encodeURIComponent(id)}`,undefined,signal),
  };
}
export type MerchantAssistantApi = ReturnType<typeof merchantAssistantEndpoints>;
