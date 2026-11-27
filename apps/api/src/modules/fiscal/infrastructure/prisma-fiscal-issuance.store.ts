import { supportsFiscalOrderScope } from "../application/fiscal-order-scope.reader.js";
import { FISCAL_ORDER_SCOPE_UNSUPPORTED } from "../domain/fiscal-order-scope.js";
import { configuredFiscalEnvelope } from "../domain/fiscal-pending-configuration.js";
import { safelyObserveFiscal, type FiscalObservationPort } from "../domain/fiscal-observation.port.js";
import type { FiscalProfileService } from "../application/fiscal-profile.service.js";
import { randomUUID } from "node:crypto";
import { loadFiscalStockBinding } from "../../../shared/persistence/fiscal-stock-coordination.js";
import type { FiscalStockEffectEvidence } from "../domain/fiscal-stock-evidence.port.js";
import { Prisma, type FiscalIntent, type PrismaClient } from "@prisma/client";
import { assertFiscalIdentity, type FiscalProviderDocument, type FiscalState, type FiscalSubmissionResult } from "../domain/fiscal-provider.js";
import type { FiscalIssuanceContext } from "../domain/fiscal-issuance.port.js";
import type { FiscalIntentRecord, FiscalTenant } from "../domain/fiscal-repository.port.js";
import type { FiscalPaymentEvidence } from "../domain/fiscal-payment-evidence.port.js";
import type { FiscalProviderStage, FiscalProviderStageJournal, FiscalProviderStageRecord } from "../domain/fiscal-provider-stage.port.js";
import { readFiscalSnapshotEnvelope } from "../domain/fiscal-sale-snapshot.port.js";
import { restoreFiscalProviderEmailRequest } from "../domain/fiscal-provider-email.js";
import { applyFiscalProviderDocument, type FiscalStateRecord } from "../domain/fiscal-state.js";
import { fiscalObjectFingerprint } from "./providers/omie-fiscal.payload.js";

const stageRevision = (revision: number, stage: FiscalProviderStage) => stage === "contact.create" || stage === "order.create" ? 0 : revision;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const safeCode = (value: string) => /^[a-z][a-z0-9_.:-]{0,159}$/.test(value) ? value : "fiscal_provider_unavailable";
export class PrismaFiscalIssuanceStore {
  constructor(readonly prisma: PrismaClient, readonly clock: () => Date = () => new Date(), private readonly profiles?: FiscalProfileService, readonly observations?: FiscalObservationPort) {}
  async claimForQuery(scope: FiscalTenant, id: string) {
    return this.prisma.$transaction(async tx => {
      const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM fiscal_intents WHERE id = ${id} AND merchant_id = ${scope.merchantId} AND environment::text = ${scope.environment}
        AND (lease_until IS NULL OR lease_until <= ${this.clock()}) FOR UPDATE SKIP LOCKED`;
      if (!rows[0]) return null;
      return tx.fiscalIntent.update({ where: { id }, data: { leaseToken: randomUUID(), leasePurpose: "query", leaseUntil: new Date(this.clock().getTime() + 120000), attempts: { increment: 1 } } });
    });
  }
  async claimForCancellation(scope: FiscalTenant, id: string, reviewId: string, confirmation: { actorId: string; justification: string }) {
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM fiscal_intents WHERE id = ${id} AND merchant_id = ${scope.merchantId} AND environment::text = ${scope.environment} FOR UPDATE`;
      const intent = await tx.fiscalIntent.findFirst({ where: { ...scope, id } });
      const review = await tx.fiscalCancellationReview.findFirst({ where: { ...scope, id: reviewId, document: { intentId: id, state: "authorized" } } });
      if (!intent || intent.state !== "authorized" || !review || review.triggerKind === "partial_refund" || !confirmation.actorId || confirmation.justification.trim().length < 15 || confirmation.justification.length > 255) return null;
      if (await tx.fiscalProviderStageReceipt.count({ where: { ...scope, intentId: id, stage: "invoice.cancel" } })) return null;
      if (review.confirmedAt && (review.justification !== confirmation.justification || review.confirmedBy !== confirmation.actorId)) return null;
      await tx.fiscalCancellationReview.update({ where: { id: review.id }, data: { reviewState: "requesting", confirmedBy: confirmation.actorId, confirmedAt: review.confirmedAt ?? this.clock(), justification: confirmation.justification, safeReasonCode: null } });
      await tx.fiscalEvent.create({ data: { ...scope, intentId: id, actorKind: "merchant", actorId: confirmation.actorId, action: "cancellation.confirmed", providerEvidenceRef: "review:" + review.id } });
      // Revokes any prior issuance/read lease. Only this durable confirmed purpose admits cancel IO.
      return tx.fiscalIntent.update({ where: { id }, data: { leaseToken: randomUUID(), leasePurpose: "cancellation", leaseUntil: new Date(this.clock().getTime() + 120000), version: { increment: 1 } } });
    });
  }
  private async context(scope: FiscalTenant, id: string): Promise<FiscalIssuanceContext> {
    const intent = await this.prisma.fiscalIntent.findFirst({ where: { ...scope, id }, include: { connection: true, snapshot: true, profile: true } });
    if (!intent) throw new Error("fiscal_document_not_found");
    const { connection, profile } = intent; let snapshot = intent.snapshot; let envelope = readFiscalSnapshotEnvelope(snapshot.items);
    if (this.profiles && await this.prisma.fiscalEvent.findFirst({ where: { ...scope, intentId: id, action: "configuration.first_issuance_admitted" } })) {
      envelope = configuredFiscalEnvelope(snapshot, profile, this.profiles.readiness(profile));
      snapshot = { ...snapshot, items: json(envelope) as Prisma.JsonValue };
    }
    if (connection.merchantId !== intent.merchantId || connection.environment !== intent.environment || snapshot.merchantId !== intent.merchantId || snapshot.environment !== intent.environment
      || envelope.connectionId !== intent.connectionId || (envelope.erpConnectionId ?? null) !== connection.erpConnectionId || snapshot.orderId !== intent.orderId || profile.provider !== connection.provider) throw new Error("fiscal_identity_mismatch");
    const identity = { merchantId: intent.merchantId, environment: intent.environment, connectionId: intent.connectionId, provider: connection.provider, issuerTaxId: connection.issuerTaxId, reference: intent.stableReference };
    return { intent, identity, connection, snapshot, profile, envelope, orderScopeSupported: await supportsFiscalOrderScope(this.prisma, snapshot) };
  }
  async open(claim: FiscalIntentRecord): Promise<PrismaFiscalIssuanceSession> {
    const context = await this.context({ merchantId: claim.merchantId, environment: claim.environment }, claim.id); const intent = context.intent;
    if (intent.leaseToken !== claim.leaseToken || intent.version !== claim.version || !intent.leaseUntil || intent.leaseUntil <= this.clock()) throw new Error("fiscal_claim_lost");
    return new PrismaFiscalIssuanceSession(this, context);
  }
  async readOnly(scope: FiscalTenant, id: string): Promise<PrismaFiscalIssuanceSession> { return new PrismaFiscalIssuanceSession(this, await this.context(scope, id), true); }
  async reprocess(scope: FiscalTenant, id: string, profileId: string, actor: { actorKind: string; actorId: string; permission: string }) {
    if (actor.permission !== "fiscal.reprocess" || !actor.actorId) throw new Error("fiscal_reprocess_not_allowed");
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM fiscal_intents WHERE id = ${id} AND merchant_id = ${scope.merchantId} AND environment::text = ${scope.environment} FOR UPDATE`;
      const intent = await tx.fiscalIntent.findFirst({ where: { ...scope, id }, include: { connection: true, profile: true, snapshot: true } });
      const rejected = await tx.fiscalEvent.findFirst({ where: { ...scope, intentId: id, action: "provider.rejected", actorKind: "provider" }, orderBy: { occurredAt: "desc" } });
      const document = await tx.fiscalDocument.findFirst({ where: { ...scope, intentId: id } });
      const profile = await tx.fiscalProfileVersion.findFirst({ where: { ...scope, id: profileId, provider: intent?.connection.provider, confirmedBy: { not: null }, confirmedAt: { not: null } } });
      const uncertain = await tx.fiscalProviderStageReceipt.count({ where: { ...scope, intentId: id, outcome: { in: ["started", "unknown"] } } });
      if (!intent || intent.state !== "rejected" || !rejected || !document || document.state !== "rejected" || document.authorizationProtocol || uncertain || !profile || intent.connection.disconnectedAt) throw new Error("fiscal_reprocess_not_allowed");
      if (!await supportsFiscalOrderScope(tx, intent.snapshot)) throw new Error(FISCAL_ORDER_SCOPE_UNSUPPORTED);
      // ERP corrections require their documented panel/action. Reusing an old accepted order does not rewrite a remote draft.
      if (intent.connection.provider !== "focus") throw new Error("fiscal_reprocess_requires_erp_correction");
      await tx.fiscalIntent.update({ where: { id }, data: { profileVersionId: profileId, issuanceRevision: { increment: 1 }, state: "queued", leaseToken: null, leaseUntil: null, version: { increment: 1 }, nextAttemptAt: this.clock(), lastErrorCode: null } });
      await tx.fiscalEvent.create({ data: { ...scope, intentId: id, actorKind: actor.actorKind, actorId: actor.actorId, action: "issuance.reprocess_admitted", previousState: "rejected", nextState: "queued", providerEvidenceRef: "revision:" + (intent.issuanceRevision + 1) } });
    });
  }
}
export class PrismaFiscalIssuanceSession {
  readonly journal: FiscalProviderStageJournal;
  constructor(private readonly store: PrismaFiscalIssuanceStore, readonly context: FiscalIssuanceContext, private readonly readOnlyMode = false) {
    this.journal = { check: (identity, stage) => this.check(identity, stage), read: (identity, stage) => this.read(identity, stage), begin: record => this.writeStage(record, true), finish: record => this.writeStage(record, false) };
  }
  private scope() { return { merchantId: this.context.intent.merchantId, environment: this.context.intent.environment }; }
  private key(stage: FiscalProviderStage) { return { intentId: this.context.intent.id, revision: stageRevision(this.context.intent.issuanceRevision, stage), stage }; }
  private valid(intent: FiscalIntent | null, allowFinal = false) {
    const current = this.context.intent;
    return !this.readOnlyMode && !!intent && intent.leaseToken === current.leaseToken && !!intent.leaseToken && intent.version === current.version && !!intent.leaseUntil && intent.leaseUntil > this.store.clock()
      && (allowFinal || !["suppressed", "not_eligible_before_activation", "awaiting_payment", "action_required", "rejected", "authorized", "cancelled"].includes(intent.state));
  }
  private async fenced<T>(work: (tx: Prisma.TransactionClient, intent: FiscalIntent) => Promise<{ value: T; data?: Prisma.FiscalIntentUpdateInput; afterUpdate?: (tx: Prisma.TransactionClient, next: FiscalIntent) => Promise<void> }>, lost: T, allowFinal = false): Promise<T> {
    let next: FiscalIntent | undefined;
    const result = await this.store.prisma.$transaction(async tx => {
      const scope = this.scope(); const id = this.context.intent.id;
      await tx.$queryRaw`SELECT id FROM fiscal_intents WHERE id = ${id} AND merchant_id = ${scope.merchantId} AND environment::text = ${scope.environment} FOR UPDATE`;
      const intent = await tx.fiscalIntent.findFirst({ where: { ...scope, id } }); if (!this.valid(intent, allowFinal)) return lost;
      const result = await work(tx, intent!);
      if (result.data) next = await tx.fiscalIntent.update({ where: { id }, data: { ...result.data, version: { increment: 1 } } });
      if (next && result.afterUpdate) await result.afterUpdate(tx, next);
      return result.value;
    });
    if (next) {
      const previous = this.context.intent;
      this.context.intent = next;
      const committed = next;
      safelyObserveFiscal(() => this.store.observations?.transition({ provider: this.context.identity.provider, environment: committed.environment, previousState: previous.state, state: committed.state, previousReasonCode: previous.lastErrorCode, reasonCode: committed.lastErrorCode }));
    }
    return result;
  }
  private async check(identity: FiscalIssuanceContext["identity"], stage?: FiscalProviderStage) {
    assertFiscalIdentity(this.context.identity, identity);
    const value = await this.store.prisma.fiscalIntent.findFirst({ where: { ...this.scope(), id: this.context.intent.id } }); const active = await this.store.prisma.fiscalConnection.findFirst({ where: { ...this.scope(), id: this.context.intent.connectionId, disconnectedAt: null } });
    const purpose = value?.leasePurpose;
    return !!active && (!stage || stage === "invoice.cancel" || await supportsFiscalOrderScope(this.store.prisma, this.context.snapshot)) && this.valid(value, stage === "invoice.cancel" || !stage && ["query", "cancellation"].includes(purpose ?? ""))
      && (stage === "invoice.cancel" ? purpose === "cancellation" && value!.state === "authorized" : !stage || purpose === "issuance");
  }
  private async read(identity: FiscalIssuanceContext["identity"], stage: FiscalProviderStage): Promise<FiscalProviderStageRecord | null> {
    assertFiscalIdentity(this.context.identity, identity);
    const record = await this.store.prisma.fiscalProviderStageReceipt.findFirst({ where: { ...this.scope(), ...this.key(stage) } });
    return record ? { identity, stage, reference: record.reference, outcome: record.outcome as FiscalProviderStageRecord["outcome"], ...(record.payloadHash ? { payloadHash: record.payloadHash } : {}),
      ...(record.remoteId ? { remoteId: record.remoteId } : {}), ...(record.relatedIds ? { relatedIds: record.relatedIds as Record<string, string> } : {}), ...(record.reasonCode ? { reasonCode: record.reasonCode } : {}) } : null;
  }
  private async writeStage(record: FiscalProviderStageRecord, begin: boolean): Promise<boolean> {
    assertFiscalIdentity(this.context.identity, record.identity);
    const key = this.key(record.stage);
    if (record.reference !== this.context.identity.reference + (record.stage === "contact.create" ? ":contact" : "") || record.payloadHash && !/^[a-f0-9]{64}$/.test(record.payloadHash)) throw new Error("fiscal_stage_identity_mismatch");
    if (record.remoteId && !/^[A-Za-z0-9_.:-]{1,128}$/.test(record.remoteId) || record.reasonCode && safeCode(record.reasonCode) !== record.reasonCode
      || Object.entries(record.relatedIds ?? {}).some(([k, v]) => !/^[A-Za-z][A-Za-z0-9]{0,49}$/.test(k) || typeof v !== "string" || v.length > 256)) throw new Error("fiscal_stage_metadata_invalid");
    return this.fenced(async (tx, intent) => {
      const active = await tx.fiscalConnection.findFirst({ where: { ...this.scope(), id: intent.connectionId, disconnectedAt: null } });
      if (record.stage !== "invoice.cancel" && !await supportsFiscalOrderScope(tx, this.context.snapshot)) return { value: false };
      if (!active || (record.stage === "invoice.cancel" ? intent.state !== "authorized" || intent.leasePurpose !== "cancellation" : intent.leasePurpose !== "issuance")) return { value: false };
      const old = await tx.fiscalProviderStageReceipt.findFirst({ where: { ...this.scope(), ...key } });
      if (old && (old.reference !== record.reference || old.payloadHash && record.payloadHash !== old.payloadHash || old.remoteId && record.remoteId && old.remoteId !== record.remoteId)) throw new Error("fiscal_stage_content_immutable");
      const prior = (old?.relatedIds ?? {}) as Record<string, string>;
      for (const k of ["source", "recipientFingerprint", "profileVersionId", "orderFingerprint", "emailOwner", "buyerEmailHash"]) if (prior[k] !== undefined && record.relatedIds?.[k] !== undefined && prior[k] !== record.relatedIds[k]) throw new Error("fiscal_stage_content_immutable");
      if (begin) {
        if (old && old.outcome !== "not_accepted") return { value: false };
        const uncertain = await tx.fiscalProviderStageReceipt.count({ where: { ...this.scope(), intentId: intent.id, outcome: { in: ["started", "unknown"] } } });
        if (uncertain) return { value: false };
      } else if (!old || old.outcome === "accepted" && record.outcome !== "accepted") return { value: false };
      const data = { reference: record.reference, outcome: begin ? "started" : record.outcome, payloadHash: record.payloadHash, remoteId: record.remoteId,
        relatedIds: json({ ...prior, ...record.relatedIds }), reasonCode: record.reasonCode };
      await tx.fiscalProviderStageReceipt.upsert({ where: { intentId_revision_stage: key }, create: { ...this.scope(), ...key, ...data }, update: data });
      await tx.fiscalEvent.create({ data: { ...this.scope(), intentId: intent.id, actorKind: "worker", action: "stage." + record.stage + "." + data.outcome,
        providerEvidenceRef: record.remoteId ? record.stage + ":" + record.remoteId : undefined } });
      return { value: true, data: { writeStage: record.stage, ...(begin ? { writeStartedAt: intent.writeStartedAt ?? this.store.clock() } : {}) } };
    }, false, record.stage === "invoice.cancel");
  }
  async revision() { return this.store.prisma.fiscalIssuanceRevision.findFirst({ where: { ...this.scope(), intentId: this.context.intent.id, revision: this.context.intent.issuanceRevision } }); }
  async providerEmailRequest() { return restoreFiscalProviderEmailRequest(this.context.envelope, await this.journal.read(this.context.identity, "invoice.submit"), this.context.identity.provider); }
  async freeze(payload: Readonly<Record<string, unknown>>, payment: FiscalPaymentEvidence, issuedAt = typeof payload.data_emissao === "string" ? payload.data_emissao : this.store.clock().toISOString()) {
    if (!await supportsFiscalOrderScope(this.store.prisma, this.context.snapshot)) throw new Error(FISCAL_ORDER_SCOPE_UNSUPPORTED);
    if (this.context.intent.leasePurpose !== "issuance") throw new Error("fiscal_issuance_purpose_required");
    const existing = await this.revision(); if (existing) return existing;
    const value = await this.fenced(async (tx, intent) => {
      const revision = await tx.fiscalIssuanceRevision.create({ data: { ...this.scope(), intentId: intent.id, revision: intent.issuanceRevision, profileVersionId: this.context.profile.id,
        issuedAt: new Date(issuedAt), payload: json(payload), payloadHash: fiscalObjectFingerprint(payload), paymentEvidence: json(payment) } });
      return { value: revision, data: { state: "processing" } };
    }, null);
    if (!value) throw new Error("fiscal_claim_lost"); return value;
  }
  async pending(state: FiscalState, reason: string, delay = 30000) {
    return this.fenced(async (tx, intent) => {
      if (["authorized", "cancelled", "suppressed", "not_eligible_before_activation"].includes(intent.state)) return { value: false, data: { leaseUntil: null, leaseToken: null } };
      const code = safeCode(reason);
      await tx.fiscalEvent.create({ data: { ...this.scope(), intentId: intent.id, actorKind: "worker", action: "issuance.pending", previousState: intent.state, nextState: state, safeReasonCode: code } });
      return { value: true, data: { state, lastErrorCode: code, nextAttemptAt: new Date(this.store.clock().getTime() + Math.max(1000, Math.min(delay, 3600000))), leaseUntil: null, leaseToken: null } };
    }, false, true);
  }
  async persist(receipt: FiscalSubmissionResult, stockEvidence?: FiscalStockEffectEvidence, pendingReason?: string) {
    assertFiscalIdentity(this.context.identity, receipt.identity);
    let stockRecorded = false;
    const committed = await this.fenced(async (tx, intent) => {
      const old = await tx.fiscalDocument.findFirst({ where: { ...this.scope(), intentId: intent.id } });
      let state: FiscalState = old?.authorizationProtocol ? intent.state as FiscalState : "processing"; let reason: string | null = null; let remoteInvoiceId: string | undefined;
      if (receipt.remoteInvoiceId) {
        remoteInvoiceId = receipt.remoteInvoiceId;
        const previous: FiscalStateRecord = { identity: this.context.identity, state: intent.state as FiscalState,
          ...(intent.remoteInvoiceId ? { remoteInvoiceId: intent.remoteInvoiceId } : {}), ...(intent.remoteOrderId ? { remoteOrderId: intent.remoteOrderId } : {}),
          ...(old?.authorizationProtocol ? { authorization: { number: old.number!, series: old.series!, accessKey: old.accessKey!, protocol: old.authorizationProtocol, authorizedAt: old.authorizedAt!.toISOString() } } : {}) };
        const incoming = receipt as FiscalProviderDocument;
        const normalized = incoming.status === "authorized" ? { ...incoming, authorization: { ...incoming.authorization, authorizedAt: new Date(incoming.authorization.authorizedAt).toISOString() } } : incoming;
        const result = applyFiscalProviderDocument(previous, normalized); state = result.state; reason = result.rejectionCode ? safeCode(result.rejectionCode) : null;
        const auth = result.authorization; const cancellation = result.cancellation;
        const data = { state, providerStatus: old?.authorizationProtocol && receipt.status !== "cancelled" ? old.providerStatus : safeCode(receipt.providerStatus), ...(auth ? { number: auth.number, series: auth.series, accessKey: auth.accessKey, authorizationProtocol: auth.protocol, authorizedAt: new Date(auth.authorizedAt) } : {}),
          ...(cancellation ? { cancellationProtocol: cancellation.protocol, cancelledAt: new Date(cancellation.cancelledAt) } : {}) };
        await tx.fiscalDocument.upsert({ where: { intentId: intent.id }, create: { ...this.scope(), intentId: intent.id, issuerTaxId: this.context.identity.issuerTaxId, ...data }, update: data });
        if (state === "authorized") {
          const document = await tx.fiscalDocument.findUniqueOrThrow({ where: { intentId: intent.id } });
          const changes = await tx.fiscalEvent.findMany({ where: { ...this.scope(), intentId: intent.id, action: { in: ["commercial.cancelled", "commercial.refund", "commercial.partial_refund"] } } });
          for (const event of changes) await tx.fiscalCancellationReview.createMany({ data: { ...this.scope(), documentId: document.id, triggerId: event.providerEvidenceRef!, triggerKind: event.action.slice("commercial.".length), ...(event.action === "commercial.partial_refund" ? { reviewState: "action_required", safeReasonCode: "fiscal_partial_refund_requires_review" } : {}) }, skipDuplicates: true });
        }
      }
      await tx.fiscalEvent.create({ data: { ...this.scope(), intentId: intent.id, actorKind: receipt.verifiedBy === "authenticated_query" ? "provider" : "worker", action: "provider." + state,
        previousState: intent.state, nextState: state, safeReasonCode: reason, providerEvidenceRef: receipt.remoteInvoiceId ? "invoice:" + receipt.remoteInvoiceId : "order:" + receipt.remoteOrderId } });
      if (state === "authorized") await tx.outboxMessage.upsert({ where: { eventId: "fiscal.authorized:" + intent.id }, update: {}, create: { eventId: "fiscal.authorized:" + intent.id,
        eventType: "fiscal.document.authorized", schemaVersion: 1, merchantId: intent.merchantId, occurredAt: this.store.clock(), correlationId: intent.id, causationId: intent.id, producer: "fiscal", payload: { intentId: intent.id, environment: intent.environment } } });
      return { value: true, data: { state, ...(remoteInvoiceId ? { remoteInvoiceId } : {}), ...(receipt.remoteOrderId ? { remoteOrderId: receipt.remoteOrderId } : {}), lastErrorCode: reason ?? (pendingReason ? safeCode(pendingReason) : state === "authorized" && this.context.envelope.policy.stockOwner === "provider" && !stockEvidence ? "fiscal_stock_evidence_pending" : null),
        nextAttemptAt: new Date(this.store.clock().getTime() + 30000), leaseUntil: null, leaseToken: null },
        ...(state === "authorized" && stockEvidence ? { afterUpdate: async (client: Prisma.TransactionClient, next: FiscalIntent) => {
          const binding = await loadFiscalStockBinding(client, this.scope(), next.id);
          assertFiscalIdentity(this.context.identity, stockEvidence.identity);
          const expectedOrder = receipt.remoteOrderId ?? intent.remoteOrderId;
          if (stockEvidence.intentId !== intent.id || stockEvidence.snapshotHash !== this.context.snapshot.contentHash || stockEvidence.remoteInvoiceId !== remoteInvoiceId
            || expectedOrder && stockEvidence.remoteOrderId !== expectedOrder || !stockEvidence.evidenceReference || stockEvidence.lines.length !== binding.lines.length
            || binding.lines.some(line => stockEvidence.lines.filter(x => x.sku === line.sku).reduce((n, x) => n + x.quantity, 0) !== line.quantity)) throw new Error("fiscal_stock_evidence_mismatch");
          const evidence = await client.fiscalEvent.create({ data: { ...this.scope(), intentId: next.id, actorKind: "provider", actorId: String(next.version), action: "stock_effect_reconciled", safeReasonCode: binding.evidenceCode, providerEvidenceRef: stockEvidence.evidenceReference } });
          await client.outboxMessage.create({ data: { eventId: "fiscal.stock.release_requested:" + evidence.id, eventType: "fiscal.stock.release_requested", schemaVersion: 1, merchantId: next.merchantId,
            occurredAt: this.store.clock(), correlationId: next.id, causationId: evidence.id, producer: "fiscal", payload: { intentId: next.id, environment: next.environment, evidenceEventId: evidence.id } } });
          stockRecorded = true;
        } } : {}) };

    }, false, true);
    if (committed && stockRecorded) safelyObserveFiscal(() => this.store.observations?.stock({ provider: this.context.identity.provider, environment: this.context.identity.environment, outcome: "evidence_confirmed" }));
    return committed;
  }
  async finishRead(reason?: string, delay = 30000) {
    return this.store.prisma.$transaction(async tx => {
      const scope = this.scope(), id = this.context.intent.id;
      await tx.$queryRaw`SELECT id FROM fiscal_intents WHERE id = ${id} AND merchant_id = ${scope.merchantId} AND environment::text = ${scope.environment} FOR UPDATE`;
      const current = await tx.fiscalIntent.findFirst({ where: { ...scope, id } }); if (!this.valid(current, true)) return false;
      await tx.fiscalIntent.update({ where: { id }, data: { leaseToken: null, leaseUntil: null, nextAttemptAt: new Date(this.store.clock().getTime() + delay), lastErrorCode: reason ? safeCode(reason) : null } });
      return true;
    });
  }
  async releaseEvidence() {
    const binding = await loadFiscalStockBinding(this.store.prisma, this.scope(), this.context.intent.id);
    const release = await this.store.prisma.fiscalEvent.findFirst({ where: { ...this.scope(), intentId: this.context.intent.id, action: "stock_barrier_released" } });
    if (release) return null;
    const event = await this.store.prisma.fiscalEvent.findFirst({ where: { ...this.scope(), intentId: this.context.intent.id, actorKind: "provider", action: "stock_effect_reconciled", safeReasonCode: binding.evidenceCode }, orderBy: { occurredAt: "desc" } });
    return event?.id ?? null;
  }
  async stages() {
    const values = await this.store.prisma.fiscalProviderStageReceipt.findMany({ where: { ...this.scope(), intentId: this.context.intent.id, revision: { in: [0, this.context.intent.issuanceRevision] }, outcome: { in: ["started", "unknown"] } }, orderBy: { createdAt: "asc" } });
    return Promise.all(values.map(value => this.read(this.context.identity, value.stage as FiscalProviderStage)));
  }
}
