import { supportsFiscalOrderScope } from "./fiscal-order-scope.reader.js";
import { FiscalEligibilityService } from "./fiscal-eligibility.service.js";
import type { PersistedPaymentApproval } from "../../checkout/domain/ports/payment-approval.port.js";
import type { PrismaClient } from "@prisma/client";
import type {
  FiscalTenant,
  FiscalActor,
} from "../domain/fiscal-repository.port.js";
import { configuredFiscalEnvelope } from "../domain/fiscal-pending-configuration.js";
import { FiscalProfileService } from "./fiscal-profile.service.js";
import type { FiscalProfileRecord } from "../domain/fiscal-profile.port.js";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
export class FiscalPendingConfigurationService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly profiles: FiscalProfileService,
    private readonly tenants: TenantContextService
  ) {}
  private configurable(code: string | null) { return code === "fiscal_profile_unconfirmed" || code === "fiscal_operation_unsupported" || /^fiscal_(?:payment_|crypto_|original_payment_)/.test(code ?? ""); }
  async configuredConnection(scope: FiscalTenant, connectionId: string, actor: FiscalActor) {
    const rows = await this.prisma.fiscalIntent.findMany({ where: { ...scope, connectionId, state: "action_required" }, select: { id: true, profileVersionId: true, lastErrorCode: true, writeStartedAt: true } });
    for (const row of rows) {
      if (this.configurable(row.lastErrorCode)) {
        try { await this.admit(scope, row.id, row.profileVersionId, actor); }
        catch (error) { if (error instanceof Error && ["fiscal_first_issuance_not_allowed", "fiscal_profile_unconfirmed", "fiscal_operation_unsupported", "fiscal_customer_data_required", "fiscal_payment_allocation_invalid"].includes(error.message)) continue; throw error; }
      } else if (/^fiscal_(?:erp_reconnect_required|reauthorization_required|credential_refresh_unknown_reauthorization_required)$/.test(row.lastErrorCode ?? "")) {
        await this.prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM fiscal_intents WHERE id=${row.id} AND merchant_id=${scope.merchantId} AND environment::text=${scope.environment} FOR UPDATE`;
          const original = await tx.fiscalIntent.findFirst({ where: { ...scope, id: row.id, connectionId, state: "action_required", connection: { disconnectedAt: null } }, include: { connection: true, snapshot: true } });
          if (!original) return;
          const uncertain = !!original.writeStartedAt || !!await tx.fiscalProviderStageReceipt.count({ where: { ...scope, intentId: row.id } });
          const supported = await supportsFiscalOrderScope(tx, original.snapshot);
          const state = uncertain ? "reconciliation_required" : supported ? "queued" : "action_required";
          const next = await tx.fiscalIntent.update({ where: { id: row.id }, data: { state, lastErrorCode: supported ? null : "fiscal_order_scope_unsupported", leaseToken: null, leaseUntil: null, leasePurpose: null, nextAttemptAt: new Date(), version: { increment: 1 } } });
          await tx.fiscalEvent.create({ data: { ...scope, intentId: row.id, actorKind: actor.actorKind, actorId: actor.actorId, action: "credential.original_connection_revalidated", previousState: "action_required", nextState: state } });
          if (!supported && !uncertain) return;
          await tx.outboxMessage.create({ data: { eventId: "fiscal.reconnect:" + row.id + ":" + next.version, eventType: uncertain ? "fiscal.reconciliation.requested" : "fiscal.issuance.requested", schemaVersion: 1, merchantId: scope.merchantId, occurredAt: new Date(), correlationId: row.id, causationId: connectionId, producer: "fiscal", payload: { intentId: row.id, environment: scope.environment, connectionId, provider: original.connection.provider, stableReference: original.stableReference } } });
        });
      }
    }
  }
  async admit(
    scope: FiscalTenant,
    id: string,
    profileId: string,
    actor: FiscalActor
  ) {
    if (!actor.actorId) throw new Error("fiscal_actor_required");
    const admitted = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM fiscal_intents WHERE id=${id} AND merchant_id=${scope.merchantId} AND environment::text=${scope.environment} FOR UPDATE`;
      const intent = await tx.fiscalIntent.findFirst({
        where: { ...scope, id },
        include: { snapshot: true, connection: true, document: true },
      });
      if (!intent) throw new Error("fiscal_document_not_found");
      if (intent.document?.authorizationProtocol)
        throw new Error("fiscal_authorized_content_immutable");
      if (!await supportsFiscalOrderScope(tx, intent.snapshot)) {
        if (intent.state === "action_required" && !intent.writeStartedAt && !intent.remoteOrderId && !intent.remoteInvoiceId && !intent.document
          && !await tx.fiscalProviderStageReceipt.count({ where: { ...scope, intentId: id } })) {
          await tx.fiscalIntent.update({ where: { id }, data: { lastErrorCode: "fiscal_order_scope_unsupported", version: { increment: 1 }, leaseToken: null, leaseUntil: null, leasePurpose: null } });
          await tx.fiscalEvent.create({ data: { ...scope, intentId: id, actorKind: actor.actorKind, actorId: actor.actorId, action: "issuance.pending", previousState: intent.state, nextState: "action_required", safeReasonCode: "fiscal_order_scope_unsupported" } });
          return false;
        }
        throw new Error("fiscal_first_issuance_not_allowed");
      }
      if (
        intent.state !== "action_required" ||
        !this.configurable(intent.lastErrorCode) ||
        intent.writeStartedAt ||
        intent.remoteOrderId ||
        intent.remoteInvoiceId ||
        intent.connection.disconnectedAt ||
        !intent.connection.activatedAt ||
        intent.snapshot.completedAt < intent.connection.activatedAt ||
        !intent.snapshot.paymentProofRef ||
        intent.document
      )
        throw new Error("fiscal_first_issuance_not_allowed");
      if (
        (await tx.fiscalProviderStageReceipt.count({
          where: { ...scope, intentId: id },
        })) ||
        (await tx.fiscalIssuanceRevision.count({
          where: { ...scope, intentId: id },
        })) ||
        (await tx.fiscalEvent.count({
          where: {
            ...scope,
            intentId: id,
            action: { startsWith: "commercial." },
          },
        }))
      )
        throw new Error("fiscal_first_issuance_not_allowed");
      const profile = await tx.fiscalProfileVersion.findFirst({
        where: {
          ...scope,
          id: profileId,
          provider: intent.connection.provider,
          operation: intent.operation,
          confirmedAt: { not: null },
          confirmedBy: { not: null },
        },
      });
      if (!profile) throw new Error("fiscal_profile_not_found");
      configuredFiscalEnvelope(
        intent.snapshot,
        profile,
        this.profiles.readiness(profile)
      );
      const order = await this.tenants.run(
        {
          merchantId: intent.snapshot.orderMerchantId,
          userId: "fiscal-original-sale",
          role: "system",
        },
        async () =>
          await tx.completedOrder.findFirst({
            where: {
              id: intent.snapshot.completedOrderId,
              merchantId: intent.snapshot.orderMerchantId,
            },
          })
      );
      const payment = await this.tenants.run(
        {
          merchantId: intent.snapshot.orderMerchantId,
          userId: "fiscal-original-payment",
          role: "system",
        },
        async () =>
          await tx.paymentIntent.findFirst({
            where: {
              id: intent.snapshot.paymentProofRef!,
              merchantId: intent.snapshot.orderMerchantId,
              sessionId: order?.sessionId,
              status: "approved",
            },
          })
      );
      if (
        !order ||
        !new FiscalEligibilityService().evaluate({
          sale: {
            orderId: order.externalOrderId,
            orderMerchantId: intent.snapshot.orderMerchantId,
            sessionId: order.sessionId,
            completedAt: order.completedAt,
            currency: order.currency,
            totalCents: Math.round(Number(order.orderTotal) * 100),
            cancelledAt: order.cancelledAt,
            transmittedAt: intent.writeStartedAt,
          },
          connection: intent.connection,
          approval: payment as unknown as PersistedPaymentApproval | null,
        }).eligible
      )
        throw new Error("fiscal_first_issuance_not_allowed");
      await tx.fiscalIntent.update({
        where: { id },
        data: {
          profileVersionId: profile.id,
          state: "queued",
          lastErrorCode: null,
          leaseToken: null,
          leaseUntil: null,
          leasePurpose: null,
          nextAttemptAt: new Date(),
          version: { increment: 1 },
        },
      });
      await tx.fiscalEvent.create({
        data: {
          ...scope,
          intentId: id,
          actorKind: actor.actorKind,
          actorId: actor.actorId,
          action: "configuration.first_issuance_admitted",
          previousState: "action_required",
          nextState: "queued",
          providerEvidenceRef: "profile:" + profile.id,
        },
      });
      await tx.outboxMessage.upsert({
        where: { eventId: "fiscal.configured:" + id },
        create: {
          eventId: "fiscal.configured:" + id,
          eventType: "fiscal.issuance.requested",
          schemaVersion: 1,
          merchantId: scope.merchantId,
          occurredAt: new Date(),
          correlationId: id,
          causationId: profile.id,
          producer: "fiscal",
          payload: { intentId: id, environment: scope.environment },
        },
        update: {},
      });
      return true;
    });
    if (!admitted) throw new Error("fiscal_first_issuance_not_allowed");
  }
  async confirmed(profile: FiscalProfileRecord, actor: FiscalActor) {
    const scope = {
      merchantId: profile.merchantId,
      environment: profile.environment,
    };
    const rows = await this.prisma.fiscalIntent.findMany({
      where: {
        ...scope,
        state: "action_required",
        lastErrorCode: {
          in: ["fiscal_profile_unconfirmed", "fiscal_operation_unsupported"],
        },
        connection: { provider: profile.provider },
      },
      select: { id: true },
    });
    for (const row of rows) {
      try {
        await this.admit(scope, row.id, profile.id, actor);
      } catch (error) {
        if (
          error instanceof Error &&
          [
            "fiscal_first_issuance_not_allowed",
            "fiscal_operation_unsupported",
            "fiscal_customer_data_required",
            "fiscal_payment_allocation_invalid",
          ].includes(error.message)
        )
          continue;
        throw error;
      }
    }
  }
}
