import { Prisma, type PrismaClient } from "@prisma/client";
import type { FiscalDocumentAccessPort, FiscalDocumentActor } from "../domain/fiscal-document-access.port.js";
import type { FiscalTenant } from "../domain/fiscal-repository.port.js";
import type { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
const selection = Prisma.validator<Prisma.FiscalIntentSelect>()({ id: true, merchantId: true, environment: true, orderId: true, state: true,
  document: { select: { id: true, state: true, documentState: true, number: true, series: true, accessKey: true, authorizationProtocol: true, authorizedAt: true, cancellationProtocol: true, cancelledAt: true,
    artifacts: { select: { kind: true, sha256: true, size: true, mimeType: true } } } } });
const project = (row: Prisma.FiscalIntentGetPayload<{ select: typeof selection }>) => ({ ...row, intentId: row.id });
export class PrismaFiscalDocumentAccess implements FiscalDocumentAccessPort {
  constructor(private readonly prisma: PrismaClient, private readonly tenants?: TenantContextService) {}
  private actor(actor: FiscalDocumentActor, scope: FiscalTenant): Prisma.FiscalIntentWhereInput | null {
    if (actor.kind === "merchant") return actor.actorId?.trim() && actor.merchantId === scope.merchantId && actor.permissions?.includes("fiscal.read") ? scope : null;
    if (actor.kind !== "buyer" || !actor.globalUserId?.trim()) return null;
    return { ...scope, snapshot: { OR: [{ buyerGlobalUserId: actor.globalUserId }, { buyerGlobalUserId: null, completedOrder: { session: { globalUserId: actor.globalUserId } } }] } };
  }
  async find(actor: FiscalDocumentActor, scope: FiscalTenant, intentId: string) {
    const where = this.actor(actor, scope); if (!where) return null; const row = await this.prisma.fiscalIntent.findFirst({ where: { ...where, id: intentId }, select: selection }); return row ? project(row) : null;
  }
  async order(actor: FiscalDocumentActor, input: FiscalTenant & { orderId: string }) {
    if (actor.kind === "merchant") {
      const where = this.actor(actor, input); if (!where) return null; return (await this.prisma.fiscalIntent.findMany({ where: { ...where, orderId: input.orderId }, select: selection })).map(project);
    }
    if (actor.kind !== "buyer" || !actor.globalUserId?.trim()) return null;
    const order = await this.prisma.completedOrder.findFirst({ where: { merchantId: input.merchantId, externalOrderId: input.orderId }, select: { id: true, session: { select: { globalUserId: true } }, fiscalSaleSnapshots: { where: { environment: input.environment }, select: { merchantId: true, buyerGlobalUserId: true } } } });
    if (!order) return null; const owners = new Set(order.fiscalSaleSnapshots.map(s => s.buyerGlobalUserId).filter(Boolean));
    if (owners.size ? owners.size !== 1 || !owners.has(actor.globalUserId) : order.session.globalUserId !== actor.globalUserId) return null;
    const read = async (merchantId: string) => await this.prisma.fiscalIntent.findMany({ where: { merchantId, environment: input.environment, snapshot: { orderMerchantId: input.merchantId, completedOrderId: order.id } }, select: selection });
    // Seller scopes originate exclusively in the DB relation of this already-owned commercial order.
    const rows = [];
    for (const merchantId of new Set(order.fiscalSaleSnapshots.map(s => s.merchantId))) rows.push(...await (this.tenants ? this.tenants.run({ merchantId, userId: "fiscal-owned-order", role: "system", buyerGlobalUserId: actor.globalUserId }, () => read(merchantId)) : read(merchantId)));
    return rows.map(project);
  }
  async internal(scope: FiscalTenant, intentId: string) { const row = await this.prisma.fiscalIntent.findFirst({ where: { ...scope, id: intentId }, select: selection }); return row ? project(row) : null; }
  async documentState(scope: FiscalTenant, documentId: string, state: "available" | "document_pending") {
    const result = await this.prisma.fiscalDocument.updateMany({ where: { ...scope, id: documentId, state: { in: ["authorized", "cancelled"] }, authorizationProtocol: { not: null } }, data: { documentState: state } }); if (!result.count) throw new Error("fiscal_document_not_found");
  }
}
