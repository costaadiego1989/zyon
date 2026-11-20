import { createHash } from "node:crypto";
import { assertFiscalIdentity, type FiscalIdentity, type FiscalScope, type FiscalWriteResult } from "../../domain/fiscal-provider.js";
import type { FiscalProviderStage, FiscalProviderStageJournal, FiscalProviderStageRecord } from "../../domain/fiscal-provider-stage.port.js";

export interface FiscalHttpOptions {
  scope: FiscalScope; credential: () => Promise<string>; journal?: FiscalProviderStageJournal; fetch?: typeof fetch;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonical(item)]));
  return value;
}
export function assertScope(expected: FiscalScope, actual: FiscalScope) {
  for (const key of ["merchantId", "connectionId", "provider", "environment", "issuerTaxId"] as const) {
    if (!expected[key] || expected[key] !== actual[key]) throw new Error("fiscal_identity_mismatch");
  }
}
export function remoteId(value: unknown): string {
  const id = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
  if (typeof id !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(id)) throw new Error("fiscal_provider_entity_invalid");
  return id;
}
export function safeArtifactUrl(base: string, path: string) {
  const url = new URL(path, base);
  if (url.origin !== new URL(base).origin || url.username || url.password || url.hash) throw new Error("fiscal_artifact_origin_invalid");
  return url.href;
}
export class FiscalHttpTransport {
  constructor(readonly options: FiscalHttpOptions, readonly base: string, private readonly auth: "basic" | "bearer" | "none") {}
  get journal() { if (!this.options.journal) throw new Error("fiscal_provider_journal_required"); return this.options.journal; }
  assert(identity: FiscalIdentity) { assertScope(this.options.scope, identity); if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(identity.reference)) throw new Error("fiscal_reference_invalid"); }
  async request(path: string, init: RequestInit = {}, beforeIo?: () => Promise<boolean>) {
    const url = safeArtifactUrl(this.base, path.startsWith("/") ? this.base.replace(/\/$/, "") + path : path); const token = this.auth === "none" ? "" : await this.options.credential();
    if (this.auth !== "none" && (!token?.trim() || /[\r\n]/.test(token))) throw new Error("fiscal_reauthorization_required");
    const authorization = this.auth === "basic" ? "Basic " + Buffer.from(token + ":").toString("base64") : "Bearer " + token;
    if (beforeIo && !await beforeIo()) throw new Error("fiscal_claim_lost");
    try { return await (this.options.fetch ?? fetch)(url, { ...init, method: init.method ?? "GET", redirect: "manual",
      signal: AbortSignal.timeout(15_000), headers: { accept: "application/json", ...(init.body ? { "content-type": "application/json" } : {}), ...init.headers, ...(this.auth === "none" ? {} : { authorization }) } }); }
    catch { throw new Error("fiscal_provider_unavailable"); }
  }
  async json(path: string) {
    const result = await this.request(path);
    if (result.status === 404) return null;
    if (!result.ok) throw new Error(result.status === 401 || result.status === 403 ? "fiscal_reauthorization_required" : "fiscal_provider_query_failed");
    try { return await result.json() as Record<string, unknown>; } catch { throw new Error("fiscal_provider_response_invalid"); }
  }
  async recover(identity: FiscalIdentity, stage: FiscalProviderStage, reference: string, id: string, relatedIds?: Readonly<Record<string, string>>) {
    this.assert(identity); const previous = await this.journal.read(identity, stage);
    if (previous) {
      assertFiscalIdentity(identity, previous.identity); if (previous.reference !== reference || previous.remoteId && previous.remoteId !== id) throw new Error("fiscal_stage_identity_mismatch");
      for (const key of ["emailOwner", "buyerEmailHash", "recipientFingerprint", "profileVersionId", "orderFingerprint"]) {
        if (previous.relatedIds?.[key] !== undefined && relatedIds?.[key] !== undefined && previous.relatedIds[key] !== relatedIds[key]) throw new Error("fiscal_stage_content_immutable");
      }
    }
    if (!await this.journal.check(identity)) return false;
    const record: FiscalProviderStageRecord = { ...previous, identity, stage, reference, remoteId: id,
      relatedIds: { ...previous?.relatedIds, ...relatedIds }, outcome: "accepted" };
    if (!previous && !await this.journal.begin({ ...record, outcome: "started" })) return false;
    return this.journal.finish(record);
  }
  async write<T>(identity: FiscalIdentity, stage: FiscalProviderStage, reference: string, path: string, body: unknown,
    accepted: (record: FiscalProviderStageRecord) => T, parse: (value: Record<string, unknown>) => { remoteId: string; relatedIds?: Record<string, string> }, method = "POST", metadata?: Readonly<Record<string, string>>): Promise<FiscalWriteResult<T>> {
    this.assert(identity);
    const journal = this.journal;
    const payloadHash = createHash("sha256").update(JSON.stringify(canonical({ method, path, body, metadata }))).digest("hex");
    const previous = await journal.read(identity, stage);
    if (previous) {
      assertFiscalIdentity(identity, previous.identity);
      if (previous.reference !== reference || previous.payloadHash && previous.payloadHash !== payloadHash) throw new Error("fiscal_stage_content_immutable");
      if (previous.outcome === "accepted") return { outcome: "accepted", value: accepted(previous) };
      if (previous.outcome !== "not_accepted") return { outcome: "unknown", reasonCode: "fiscal_write_outcome_unknown" };
    }
    const record: FiscalProviderStageRecord = { identity, stage, reference, payloadHash, ...(metadata ? { relatedIds: metadata } : {}), outcome: "started" };
    if (!await journal.begin(record)) return { outcome: "unknown", reasonCode: "fiscal_write_outcome_unknown" };
    let result: FiscalWriteResult<T>; let finish: FiscalProviderStageRecord;
    try {
      const response = await this.request(path, { method, body: JSON.stringify(body) }, () => journal.check(identity, stage));
      if (response.ok) {
        const ids = parse(await response.json() as Record<string, unknown>);
        finish = { ...record, ...ids, ...(metadata || ids.relatedIds ? { relatedIds: { ...metadata, ...ids.relatedIds } } : {}), outcome: "accepted" }; result = { outcome: "accepted", value: accepted(finish) };
      } else if ([400, 401, 403, 404, 422, 429].includes(response.status)) {
        const reasonCode = response.status === 401 || response.status === 403 ? "fiscal_reauthorization_required"
          : response.status === 429 ? "fiscal_provider_rate_limited" : "fiscal_provider_request_rejected";
        const seconds = Number(response.headers.get("retry-after"));
        result = { outcome: "not_accepted", reasonCode, ...(response.status === 429 && Number.isFinite(seconds) && seconds > 0 ? { retryAfterMs: Math.min(seconds * 1000, 3600000) } : {}) };
        finish = { ...record, outcome: "not_accepted", reasonCode };
      } else { result = { outcome: "unknown", reasonCode: "fiscal_write_outcome_unknown" }; finish = { ...record, outcome: "unknown" }; }
    } catch { result = { outcome: "unknown", reasonCode: "fiscal_write_outcome_unknown" }; finish = { ...record, outcome: "unknown" }; }
    try { if (!await journal.finish(finish)) return { outcome: "unknown", reasonCode: "fiscal_write_outcome_unknown" }; }
    catch { return { outcome: "unknown", reasonCode: "fiscal_write_outcome_unknown" }; }
    return result;
  }
  async artifact(path: string, kind: "xml" | "danfe") {
    const response = await this.request(safeArtifactUrl(this.base, path), { headers: { accept: kind === "xml" ? "application/xml" : "application/pdf" } });
    const mimeType = response.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
    if (!response.ok || ![kind === "xml" ? "application/xml" : "application/pdf", ...(kind === "xml" ? ["text/xml"] : [])].includes(mimeType)) throw new Error("fiscal_artifact_response_invalid");
    if (Number(response.headers.get("content-length")) > 20 * 1024 * 1024) throw new Error("fiscal_artifact_too_large");
    const reader = response.body?.getReader(); if (!reader) throw new Error("fiscal_artifact_response_invalid");
    const chunks: Uint8Array[] = []; let length = 0;
    for (;;) { const chunk = await reader.read(); if (chunk.done) break; length += chunk.value.length;
      if (length > 20 * 1024 * 1024) { await reader.cancel(); throw new Error("fiscal_artifact_too_large"); } chunks.push(chunk.value); }
    if (!length) throw new Error("fiscal_artifact_response_invalid");
    const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    if (kind === "danfe" && new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") throw new Error("fiscal_artifact_response_invalid");
    return { bytes, mimeType };
  }
}
