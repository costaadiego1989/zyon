import type { PrismaClient } from "@prisma/client";
import type {
  FiscalTenant,
  FiscalListQuery,
  FiscalActor,
  FiscalRepositoryPort,
} from "../domain/fiscal-repository.port.js";
import { fiscalProviderCapabilities } from "../domain/fiscal-provider.js";
import type { FiscalIssuanceService } from "./fiscal-issuance.service.js";
import type { FiscalReconciliationService } from "./fiscal-reconciliation.service.js";
import type { FiscalCancellationService } from "./fiscal-cancellation.service.js";
import type { FiscalDocumentService } from "./fiscal-document.service.js";
import type { FiscalPendingConfigurationService } from "./fiscal-pending-configuration.service.js";
import { readFiscalSnapshotEnvelope } from "../domain/fiscal-sale-snapshot.port.js";
import { fiscalPublicReasonCode, fiscalStockStatus } from "./fiscal-invoice-status.js";
const states = [
  "awaiting_payment",
  "not_eligible_before_activation",
  "queued",
  "processing",
  "reconciliation_required",
  "action_required",
  "rejected",
  "authorized",
  "cancelled",
  "suppressed",
];
export class FiscalMerchantInvoicesService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: FiscalRepositoryPort,
    private readonly issuance: FiscalIssuanceService,
    private readonly reconciliation: FiscalReconciliationService,
    private readonly cancellation: FiscalCancellationService,
    readonly documents: FiscalDocumentService,
    private readonly pending: FiscalPendingConfigurationService
  ) {}
  list(scope: FiscalTenant, query: FiscalListQuery) {
    if (query.state && !states.includes(query.state))
      throw new Error("fiscal_list_invalid");
    return this.repository.list(scope, query);
  }
  async detail(scope: FiscalTenant, id: string, actor: FiscalActor) {
    const row = await this.prisma.fiscalIntent.findFirst({
      where: { ...scope, id },
      select: {
        id: true,
        orderId: true,
        state: true,
        lastErrorCode: true,
        attempts: true,
        nextAttemptAt: true,
        writeStartedAt: true,
        connection: { select: { provider: true, disconnectedAt: true } },
        snapshot: {
          select: {
            recipient: true,
            completedAt: true,
            totalCents: true,
            currency: true,
            items: true,
          },
        },
        document: {
          select: {
            id: true,
            deliveries: {
              select: { channel: true, state: true, safeReasonCode: true },
            },
            cancellations: {
              select: {
                id: true,
                triggerKind: true,
                reviewState: true,
                safeReasonCode: true,
                confirmedAt: true,
                confirmedBy: true,
              },
              orderBy: { createdAt: "asc" },
            },
          },
        },
        events: {
          select: {
            id: true,
            actorKind: true,
            actorId: true,
            action: true,
            previousState: true,
            nextState: true,
            occurredAt: true,
            safeReasonCode: true,
          },
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
        },
      },
    });
    if (!row) throw new Error("fiscal_document_not_found");
    const capabilities = fiscalProviderCapabilities(row.connection.provider);
    const reviews = row.document?.cancellations ?? [];
    const allowedActions: Array<{
      kind: string;
      label: string;
      reviewId?: string;
    }> = [];
    if (
      row.writeStartedAt &&
      !row.connection.disconnectedAt &&
      !["cancelled", "suppressed"].includes(row.state)
    )
      allowedActions.push({ kind: "reconcile", label: "Consultar resultado" });
    if (
      row.state === "action_required" &&
      (["fiscal_profile_unconfirmed", "fiscal_operation_unsupported"].includes(row.lastErrorCode ?? "") || /^fiscal_(?:payment_|crypto_|original_payment_)/.test(row.lastErrorCode ?? "")) &&
      !row.writeStartedAt
    )
      allowedActions.push({
        kind: "configure",
        label: "Validar configuração fiscal",
      });
    if (row.state === "rejected" && !row.connection.disconnectedAt)
      allowedActions.push({
        kind: row.connection.provider === "focus" ? "reprocess" : "erp_panel",
        label:
          row.connection.provider === "focus"
            ? "Reprocessar correção"
            : "Corrigir no ERP",
      });
    for (const review of reviews.filter(
      (v) => v.reviewState !== "cancelled" && v.triggerKind !== "partial_refund"
    ))
      if (row.state === "authorized")
        allowedActions.push({
          kind:
            capabilities.cancellation === "erp_panel"
              ? "erp_panel"
              : "request_cancellation",
          label:
            capabilities.cancellation === "erp_panel"
              ? "Cancelar no ERP"
              : "Solicitar cancelamento fiscal",
          reviewId: review.id,
        });
    if (row.state === "action_required" && /^fiscal_(?:erp_reconnect_required|reauthorization_required|credential_refresh_unknown_reauthorization_required)$/.test(row.lastErrorCode ?? "")) allowedActions.push({ kind: "reconnect", label: "Reconectar integração original" });
    const metadata = await this.documents.forIntent(
      {
        kind: "merchant",
        merchantId: scope.merchantId,
        actorId: actor.actorId!,
        permissions: ["fiscal.read"],
      },
      scope,
      id
    );
    return {
      id: row.id,
      orderId: row.orderId,
      state: row.state,
      provider: row.connection.provider,
      environment: scope.environment,
      recipientName: String(
        (row.snapshot.recipient as Record<string, unknown>).name ?? ""
      ),
      completedAt: row.snapshot.completedAt,
      totalCents: row.snapshot.totalCents,
      currency: row.snapshot.currency,
      reasonCode: fiscalPublicReasonCode(row.lastErrorCode),
      stock: fiscalStockStatus(readFiscalSnapshotEnvelope(row.snapshot.items).policy.stockOwner, row.events, row.lastErrorCode),
      attempts: row.attempts,
      nextAttemptAt: row.nextAttemptAt,
      document: metadata,
      deliveries: row.document?.deliveries ?? [],
      reviews,
      history: row.events.map((e) => ({
        ...e,
        safeReasonCode: fiscalPublicReasonCode(e.safeReasonCode),
      })),
      allowedActions,
    };
  }
  async reconcile(scope: FiscalTenant, id: string, actor: FiscalActor) {
    await this.detail(scope, id, actor);
    const row = await this.prisma.fiscalCancellationReview.findFirst({
      where: {
        ...scope,
        document: { intentId: id },
        reviewState: { not: "cancelled" },
      },
      orderBy: { createdAt: "asc" },
    });
    if (row) await this.cancellation.reconcile(scope, row.id);
    else {
      const result = await this.reconciliation.reconcile(scope, id);
      if (result.retryable) throw new Error("fiscal_reconciliation_pending");
    }
    return this.detail(scope, id, actor);
  }
  async reprocess(
    scope: FiscalTenant,
    id: string,
    profileId: string,
    actor: FiscalActor
  ) {
    if (!profileId) throw new Error("fiscal_profile_required");
    const row = await this.prisma.fiscalIntent.findFirst({
      where: { ...scope, id },
      select: {
        state: true,
        document: { select: { authorizationProtocol: true } },
      },
    });
    if (!row) throw new Error("fiscal_document_not_found");
    if (row.document?.authorizationProtocol)
      throw new Error("fiscal_authorized_content_immutable");
    if (row.state === "action_required")
      await this.pending.admit(scope, id, profileId, actor);
    else
      await this.issuance.reprocess(scope, id, profileId, {
        actorKind: actor.actorKind,
        actorId: actor.actorId!,
        permission: "fiscal.reprocess",
      });
    return this.detail(scope, id, actor);
  }
  async requestCancellation(
    scope: FiscalTenant,
    id: string,
    actor: FiscalActor,
    input: { reviewId: string; confirmed: boolean; justification: string }
  ) {
    await this.detail(scope, id, actor);
    const review = await this.prisma.fiscalCancellationReview.findFirst({
      where: { ...scope, id: input.reviewId, document: { intentId: id } },
    });
    if (!review) throw new Error("fiscal_document_not_found");
    await this.cancellation.request(
      scope,
      review.id,
      {
        merchantId: scope.merchantId,
        actorId: actor.actorId!,
        permissions: ["fiscal.cancel"],
      },
      { confirmed: input.confirmed, justification: input.justification }
    );
    return this.detail(scope, id, actor);
  }
}
