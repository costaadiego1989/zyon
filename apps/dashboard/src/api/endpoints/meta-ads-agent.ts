import type { MetaAdsActionKind, MetaAdsCampaign, MetaAdsCampaignDraft, MetaAdsCampaignReadiness, MetaAdsCheckout, MetaAdsConnection, MetaAdsExecution, MetaAdsGeneration, MetaAdsMetrics, MetaAdsOverview, MetaAdsProduct, MetaAdsProposal, MetaAdsSubscription } from "@zyon/shared-types";
import { dashboardJson } from "../http/client.js";

export interface MetaAdsSelection { accountId: string; pageId?: string | null; catalogId?: string | null; datasetId?: string | null; whatsappId?: string | null; }
export interface MetaAdsProposalInput { kind: MetaAdsActionKind; after?: Record<string, unknown>; reasoning: string; idempotencyKey: string; }
export function metaAdsAgentEndpoints(base: string, f: typeof fetch = globalThis.fetch) {
  const prefix = "/meta-ads-agent";
  const get = <T>(path = "") => dashboardJson<T>(base, prefix + path, {method: "GET"}, f);
  const post = <T>(path: string, jsonBody: unknown = {}) => dashboardJson<T>(base, prefix + path, {method: "POST", jsonBody}, f);
  const id = encodeURIComponent;
  return {
    overview: () => get<MetaAdsOverview>(),
    checkout: (input: {kind: "subscription" | "extra_images"; idempotencyKey: string; offerVersion: string}) => post<MetaAdsCheckout>("/checkout", input),
    cancel: () => post<MetaAdsSubscription>("/cancel"),
    startConnection: () => post<{authorizationUrl: string}>("/connection/start"),
    completeConnection: (state: string, code: string) => post<MetaAdsConnection>("/connection/complete", {state, code}),
    selectConnection: (input: MetaAdsSelection) => post<MetaAdsConnection>("/connection/select", input),
    disconnect: () => post<void>("/connection/disconnect"),
    products: (query = "") => get<MetaAdsProduct[]>(`/products?${new URLSearchParams({query})}`),
    existing: () => get<Array<{id: string; name: string; status: string}>>("/existing"),
    existingMetrics: (campaignId: string, since: string, until: string) => get<MetaAdsMetrics>(`/existing/${id(campaignId)}/metrics?${new URLSearchParams({since, until})}`),
    createCampaign: (draft: MetaAdsCampaignDraft, idempotencyKey: string) => post<MetaAdsCampaign>("/campaigns", {draft, idempotencyKey}),
    saveCampaign: (campaignId: string, draft: MetaAdsCampaignDraft) => dashboardJson<MetaAdsCampaign>(base, `${prefix}/campaigns/${id(campaignId)}`, {method: "PUT", jsonBody: draft}, f),
    readiness: (campaignId: string) => get<MetaAdsCampaignReadiness>(`/campaigns/${id(campaignId)}/readiness`),
    stopManaging: (campaignId: string) => post<MetaAdsCampaign>(`/campaigns/${id(campaignId)}/stop`),
    generate: (campaignId: string, imageCount: number, idempotencyKey: string) => post<MetaAdsGeneration>(`/campaigns/${id(campaignId)}/generations`, {imageCount, idempotencyKey}),
    propose: (campaignId: string, input: MetaAdsProposalInput) => post<MetaAdsProposal>(`/campaigns/${id(campaignId)}/proposals`, input),
    approve: (proposalId: string, digest: string) => post<MetaAdsProposal>(`/proposals/${id(proposalId)}/approve`, {digest}),
    reject: (proposalId: string) => post<MetaAdsProposal>(`/proposals/${id(proposalId)}/reject`),
    execute: (proposalId: string) => post<MetaAdsExecution>(`/proposals/${id(proposalId)}/execute`),
    reconcile: (executionId: string) => post<MetaAdsExecution>(`/executions/${id(executionId)}/reconcile`),
  };
}
export type MetaAdsAgentApi = ReturnType<typeof metaAdsAgentEndpoints>;
