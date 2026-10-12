import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { MelhorEnvioReverseAdapter, type ReversePackage, type ReverseRequest, type ReverseSource } from "../../shipping/infrastructure/adapters/melhor-envio-reverse.adapter.js";
import { awaitingReturnLabel } from "./return-shipping-state.js";
import { lockSupportResource, persistSupportMessage } from "../../support/application/support-persistence.js";
import { enqueueReturnNotice } from "../../notifications/application/return-notice-persistence.js";
import type { ReturnNoticeType } from "../../notifications/domain/return-notice.js";
import { fundingHash } from "../../marketplace/infrastructure/repositories/prisma-marketplace-funding.repository.js";
import { verifyMarketplaceShipmentRecord } from "../../shipping/domain/marketplace-shipment-proof.js";
import type { FrozenMarketplaceFunding } from "../../marketplace/domain/services/marketplace-funding-budget.js";

const prefix = "return_reverse_";
const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const key = (host: string, ret: string, origin: string) => prefix + createHash("sha256").update(JSON.stringify([host, ret, origin])).digest("hex");
const json = (value: unknown) => value as Prisma.InputJsonValue;
type Source = ReverseSource & { originName: string; sessionId: string };
export type ReversePreparation = { serviceId: 1 | 2; packages: Array<{ originMerchantId: string; package: ReversePackage; email?: string; phone?: string }> };

/** Uses existing shipment/event persistence, one durable attempt per return and
 * destination seller. Uncertain checkout and generation are never repeated. */
@Injectable()
export class ReturnReverseShippingService {
  private readonly logger = new Logger(ReturnReverseShippingService.name);
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(MelhorEnvioReverseAdapter) private readonly carrier: MelhorEnvioReverseAdapter) {}

  private async returned(host: string, returnId: string) {
    const ret = await this.prisma.return.findFirst({ where: { id: returnId, merchantId: host }, include: { items: true, label: true } });
    if (!ret) throw new NotFoundException("return_not_found");
    return ret;
  }
  private rows(host: string, returnId: string) {
    return this.prisma.trackingEvent.findMany({ where: { merchantId: host, id: { startsWith: prefix },
      carrierRaw: { path: ["returnId"], equals: returnId } }, orderBy: { id: "asc" }, take: 100 });
  }
  async assertManualAllowed(host: string, returnId: string) {
    if ((await this.rows(host, returnId)).length) throw new ConflictException("return_reverse_attempt_already_exists");
  }
  async cancelReturn(host: string, returnId: string) {
    await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM returns WHERE id = ${returnId} AND merchant_id = ${host} FOR UPDATE`;
      const current = await tx.return.findFirst({ where: { id: returnId, merchantId: host } });
      if (!current || !["REQUESTED", "LABEL_GENERATED"].includes(current.status)) throw new ConflictException("return_status_changed");
      const financialAttempt = await tx.trackingEvent.count({ where: { merchantId: host, id: { startsWith: prefix },
        carrierRaw: { path: ["returnId"], equals: returnId }, status: { notIn: ["reverse_cart_ready", "reverse_cart_unknown"] } } });
      if (financialAttempt) throw new ConflictException("return_reverse_purchase_requires_review_before_cancellation");
      await tx.return.update({ where: { id: returnId }, data: { status: "CANCELLED" } });
    });
  }
  async view(host: string, returnId: string) {
    await this.returned(host, returnId);
    const rows = await this.rows(host, returnId);
    return { returnId, amountCents: rows.reduce((sum, row) => sum + Number(object(row.carrierRaw).amountCents ?? 0), 0),
      shipments: rows.map(row => { const data = object(row.carrierRaw); return { id: row.id, originMerchantId: data.request.originMerchantId as string,
        originName: data.originName as string, amountCents: data.amountCents as number | null, status: row.status,
        postingCode: data.postingCode as string | null, declarationUrl: (data.declarationUrl as string | null) ?? null, serviceId: data.request.body.service as 1 | 2 }; }) };
  }
  async candidates(host: string, returnId: string) {
    const ret = await this.returned(host, returnId), view = await this.view(host, returnId);
    if (view.shipments.length) return { ...view, candidates: [] };
    if (!awaitingReturnLabel(ret)) throw new ConflictException("invalid_status_for_label_generation");
    const sources = await this.sources(host, ret);
    const candidates = [];
    for (const source of sources) {
      try { const original = await this.carrier.original(source); candidates.push({ originMerchantId: source.originMerchantId,
        originName: source.originName, package: original.package, email: original.email, phone: original.phone }); }
      catch { throw new ConflictException("return_reverse_original_label_or_account_unavailable"); }
    }
    return { ...view, candidates };
  }
  async prepare(host: string, returnId: string, input: ReversePreparation) {
    if (!input || ![1, 2].includes(input.serviceId) || !Array.isArray(input.packages) || !input.packages.length || input.packages.length > 100 ||
      input.packages.some(row => !row || typeof row.originMerchantId !== "string" || !row.originMerchantId.trim()) ||
      new Set(input.packages.map(row => row?.originMerchantId)).size !== input.packages.length) throw new BadRequestException("return_reverse_packages_required");
    const ret = await this.returned(host, returnId), previous = await this.rows(host, returnId);
    if (previous.length) return this.view(host, returnId);
    if (!awaitingReturnLabel(ret)) throw new ConflictException("invalid_status_for_label_generation");
    const sources = await this.sources(host, ret);
    if (sources.length !== input.packages.length || input.packages.some(row => !sources.some(s => s.originMerchantId === row.originMerchantId))) throw new BadRequestException("return_reverse_origins_mismatch");
    const requests: Array<{ source: Source; request: ReverseRequest }> = [];
    for (const source of sources) {
      const parcel = input.packages.find(row => row.originMerchantId === source.originMerchantId)!;
      try { requests.push({ source, request: await this.carrier.prepareRequest(source, { ...parcel, serviceId: input.serviceId }) }); }
      catch { throw new BadRequestException("return_reverse_package_contact_or_account_invalid"); }
    }
    // All origins are checked before creating any carrier cart. The row lock
    // serializes concurrent preparation, manual registration and cancellation.
    const owned = await this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM returns WHERE id = ${returnId} AND merchant_id = ${host} FOR UPDATE`;
      const current = await tx.return.findFirst({ where: { id: returnId, merchantId: host }, include: { label: true } });
      if (!current || !awaitingReturnLabel(current)) throw new ConflictException("return_status_changed");
      if ((await tx.trackingEvent.count({ where: { merchantId: host, id: { in: requests.map(row => key(host, returnId, row.source.originMerchantId)) } } })) > 0) return false;
      for (const { source, request } of requests) {
        const id = key(host, returnId, source.originMerchantId);
        await tx.shipment.create({ data: { id, merchantId: host, sessionId: source.sessionId, externalOrderId: id,
          carrier: "melhor-envio-reverse", trackingCode: id, status: "reverse_prepared" } });
        await tx.trackingEvent.create({ data: { id, merchantId: host, shipmentId: id, trackingCode: id,
          status: "reverse_cart_unknown", description: "Preparação do frete de devolução", occurredAt: new Date(),
          carrierRaw: json({ returnId, originName: source.originName, request, requestHash: fundingHash(request), amountCents: null, carrierOrderId: null, postingCode: null, finalized: false }) } });
      }
      return true;
    });
    if (owned) for (const { source, request } of requests) {
      const id = key(host, returnId, source.originMerchantId);
      try {
        const carrierOrderId = await this.carrier.create(request);
        const row = await this.prisma.trackingEvent.findUniqueOrThrow({ where: { id } }), data = object(row.carrierRaw);
        await this.prisma.trackingEvent.update({ where: { id }, data: { carrierRaw: json({ ...data, carrierOrderId }) } });
        const observation = await this.carrier.read(request, carrierOrderId);
        if (!observation.purchasable) throw Error();
        await this.prisma.trackingEvent.update({ where: { id }, data: { status: "reverse_cart_ready",
          carrierRaw: json({ ...data, carrierOrderId, amountCents: observation.amountCents }) } });
      } catch { this.logger.warn(`return_reverse_cart_unproven return=${returnId} attempt=${id}`); }
    }
    return this.view(host, returnId);
  }

  async confirm(host: string, returnId: string, expectedAmountCents: number) {
    const ret = await this.returned(host, returnId), rows = await this.rows(host, returnId);
    if (!rows.length || !Number.isSafeInteger(expectedAmountCents) || expectedAmountCents < 0 ||
      rows.some(row => !Number.isSafeInteger(object(row.carrierRaw).amountCents)) ||
      rows.reduce((sum, row) => sum + object(row.carrierRaw).amountCents, 0) !== expectedAmountCents) throw new ConflictException("return_reverse_cost_not_confirmed");
    if (!["REQUESTED", "LABEL_GENERATED"].includes(ret.status)) throw new ConflictException("return_status_changed");
    for (const row of rows) await this.advance(row, true);
    await this.finish(host, returnId);
    return this.view(host, returnId);
  }
  async reconcile(limit = 10) {
    const rows = await this.prisma.trackingEvent.findMany({ where: { id: { startsWith: prefix },
      OR: [{ status: { in: ["reverse_cart_unknown", "reverse_purchase_unknown", "reverse_generation_unknown"] } },
        { status: "reverse_generated", carrierRaw: { path: ["finalized"], equals: false } },
        { status: "reverse_generated", carrierRaw: { path: ["declarationPending"], equals: true } }],
      occurredAt: { lt: new Date(Date.now() - 60_000) } }, take: limit, orderBy: { occurredAt: "asc" } });
    for (const row of rows) {
      try {
        // Rotate unresolved attempts through the bounded batch as well.
        await this.prisma.trackingEvent.updateMany({ where: { id: row.id, status: row.status, occurredAt: row.occurredAt }, data: { occurredAt: new Date() } });
        if (row.status !== "reverse_generated") await this.advance(row, false);
        await this.finish(row.merchantId, object(row.carrierRaw).returnId); }
      catch { this.logger.warn(`return_reverse_reconciliation_pending attempt=${row.id}`); }
    }
  }
  private async advance(row: Awaited<ReturnType<ReturnReverseShippingService["rows"]>>[number], submit: boolean) {
    const data = object(row.carrierRaw), request = data.request as ReverseRequest;
    if (fundingHash(request) !== data.requestHash || !data.carrierOrderId || row.id !== key(row.merchantId, data.returnId, request.originMerchantId)) return;
    let status = row.status;
    try {
      let observed = await this.carrier.read(request, data.carrierOrderId, data.amountCents ?? undefined);
      if (status === "reverse_cart_unknown" && observed.purchasable) {
        await this.prisma.trackingEvent.updateMany({ where: { id: row.id, status }, data: { status: "reverse_cart_ready",
          carrierRaw: json({ ...data, amountCents: observed.amountCents }), occurredAt: new Date() } }); return;
      }
      if (status === "reverse_cart_ready" && submit) {
        // Claim before debit, including a fresh return status check. Once claimed,
        // all further calls can only observe the existing carrier purchase.
        const claimed = await this.prisma.$transaction(async tx => {
          await tx.$queryRaw`SELECT id FROM returns WHERE id = ${data.returnId} AND merchant_id = ${row.merchantId} FOR UPDATE`;
          const ret = await tx.return.findFirst({ where: { id: data.returnId, merchantId: row.merchantId }, include: { label: true } });
          if (!ret || !awaitingReturnLabel(ret) || !observed.purchasable) return false;
          return (await tx.trackingEvent.updateMany({ where: { id: row.id, status }, data: { status: "reverse_purchase_unknown", occurredAt: new Date() } })).count === 1;
        });
        if (!claimed) return;
        status = "reverse_purchase_unknown";
        try { await this.carrier.checkout(request, data.carrierOrderId, data.amountCents); } catch { /* GET evidence below. */ }
        observed = await this.carrier.read(request, data.carrierOrderId, data.amountCents);
      }
      if (status === "reverse_purchase_unknown" && observed.paid) {
        if ((await this.prisma.trackingEvent.updateMany({ where: { id: row.id, status }, data: { status: "reverse_purchased", occurredAt: new Date() } })).count !== 1) return;
        status = "reverse_purchased";
      }
      if (status === "reverse_purchased" && submit) {
        if ((await this.prisma.trackingEvent.updateMany({ where: { id: row.id, status }, data: { status: "reverse_generation_unknown", occurredAt: new Date() } })).count !== 1) return;
        status = "reverse_generation_unknown";
        try { await this.carrier.generate(request, data.carrierOrderId, data.amountCents); } catch { /* GET evidence below. */ }
        observed = await this.carrier.read(request, data.carrierOrderId, data.amountCents);
      }
      if (["reverse_purchased", "reverse_generation_unknown"].includes(status) && observed.code) {
        await this.prisma.trackingEvent.updateMany({ where: { id: row.id, status }, data: { status: "reverse_generated", occurredAt: new Date(),
          description: "Código de devolução confirmado pelo Melhor Envio", carrierRaw: json({ ...data, postingCode: observed.code, generatedAt: observed.generatedAt, declarationPending: true }) } });
      }
    } catch { this.logger.warn(`return_reverse_provider_unproven return=${data.returnId} attempt=${row.id}`); }
  }
  private async finish(host: string, returnId: string) {
    let rows = await this.rows(host, returnId);
    if (!rows.length || rows.some(row => row.status !== "reverse_generated" || !object(row.carrierRaw).postingCode)) return;
    // Retry document reads independently; they never buy or generate freight.
    for (const row of rows) {
      const data = object(row.carrierRaw);
      if (data.declarationUrl) continue;
      try {
        const url = await this.carrier.declaration(data.request as ReverseRequest, data.carrierOrderId, data.amountCents);
        await this.prisma.trackingEvent.update({ where: { id: row.id }, data: { carrierRaw: json({ ...data, declarationUrl: url, declarationPending: false }) } });
      } catch { this.logger.warn(`return_reverse_declaration_pending attempt=${row.id}`); }
    }
    rows = await this.rows(host, returnId);
    await this.prisma.$transaction(async tx => {
      const ticket = await tx.supportTicket.findFirst({ where: { merchantId: host, returnId, mergedIntoId: null } });
      if (ticket) await lockSupportResource(tx, `support:${ticket.id}`);
      await tx.$queryRaw`SELECT id FROM returns WHERE id = ${returnId} AND merchant_id = ${host} FOR UPDATE`;
      const current = await tx.return.findFirst({ where: { id: returnId, merchantId: host }, include: { label: true, items: true } });
      if (!current || !["REQUESTED", "LABEL_GENERATED"].includes(current.status)) return;
      const codes = rows.map(row => { const data = object(row.carrierRaw); return rows.length === 1 ? data.postingCode : `${data.originName}: ${data.postingCode}`; }).join("; ");
      if (current.label && current.label.trackingNumber !== codes) throw new ConflictException("return_reverse_label_changed");
      const generatedDay = rows.map(row => String(object(row.carrierRaw).generatedAt).slice(0, 10)).sort()[0];
      const expiresAt = new Date(Date.parse(`${generatedDay}T00:00:00Z`) + 7 * 24 * 60 * 60 * 1000);
      if (!Number.isFinite(expiresAt.getTime())) throw new ConflictException("return_reverse_generation_date_unproven");
      if (!current.label) await tx.returnLabel.create({ data: { returnId, carrier: "Correios", trackingNumber: codes, expiresAt } });
      const declarations = rows.map(row => ({ originMerchantId: String(object(row.carrierRaw).request.originMerchantId), originName: String(object(row.carrierRaw).originName), url: object(row.carrierRaw).declarationUrl ? String(object(row.carrierRaw).declarationUrl) : null }));
      await tx.return.updateMany({ where: { id: returnId, merchantId: host, status: current.status }, data: { status: "LABEL_GENERATED",
        resolution: json({ ...object(current.resolution), returnAuthorizedAt: object(current.resolution).returnAuthorizedAt ?? new Date().toISOString(), returnDeclarations: declarations }) } });
      if (ticket) {
        const notify = async (clientMessageId: string, type: ReturnNoticeType, content: string, metadata: Prisma.InputJsonValue) => {
          if (await tx.supportTicketMessage.findFirst({ where: { ticketId: ticket.id, clientMessageId } })) return;
          const message = await persistSupportMessage(tx, { merchantId: host, ticketId: ticket.id, senderType: "system", clientMessageId, content, metadata });
          await enqueueReturnNotice(tx, { merchantId: host, ticketId: ticket.id, messageId: message.id, type, explanation: content, ret: current });
        };
        const content = "Código de devolução dos Correios: " + codes + "\nValidade até " + expiresAt.toLocaleDateString("pt-BR", { timeZone: "UTC" }) +
          ". Reembale os itens e leve o código e a declaração de conteúdo impressa a uma agência dos Correios. Aguarde a declaração antes da postagem.";
        await notify("reverse-code-" + returnId, "return_posting_code", content, { kind: "return_posting_code", returnId, postingCode: codes, expiresAt: expiresAt.toISOString() });
        if (declarations.every(doc => doc.url)) {
          const instructions = "A declaração de conteúdo da devolução está disponível. Imprima o PDF correspondente a cada pacote e leve-o com o código à agência dos Correios.\n" + declarations.map(d => d.originName + ": " + d.url).join("\n");
          await notify("reverse-declaration-" + returnId, "return_declaration_ready", instructions, json({ kind: "return_declaration_ready", returnId, declarations }));
        }
      }
      for (const row of rows) {
        const fresh = await tx.trackingEvent.findUniqueOrThrow({ where: { id: row.id } });
        await tx.trackingEvent.update({ where: { id: row.id }, data: { carrierRaw: json({ ...object(fresh.carrierRaw), finalized: true }) } });
        await tx.shipment.update({ where: { id: row.shipmentId }, data: { status: "reverse_generated" } });
      }
    });
  }

  private async sources(host: string, ret: Awaited<ReturnType<ReturnReverseShippingService["returned"]>>): Promise<Source[]> {
    if (!ret.items.length || ret.items.length > 100 || new Set(ret.items.map(i => i.variantId)).size !== ret.items.length ||
      ret.items.some(i => !Number.isSafeInteger(i.quantity) || i.quantity < 1)) throw new BadRequestException("return_items_invalid");
    const completed = await this.prisma.completedOrder.findMany({ where: { merchantId: host, OR: [{ id: ret.orderId }, { externalOrderId: ret.orderId }] }, take: 2 });
    const aliases = [...new Set([ret.orderId, ...completed.map(row => row.externalOrderId)])];
    const snapshot = completed.length === 1 && Array.isArray(completed[0].lineItemsJson) ? completed[0].lineItemsJson.map(object) : [];
    const productName = (variantId: string, unitCents: number) => {
      const matching = snapshot.filter(row => row.variantId === variantId);
      if (!matching.length || matching.some(row => typeof row.name !== "string" || !row.name.trim() || row.name !== matching[0].name || row.unitPriceCents !== unitCents)) {
        throw new ConflictException("return_reverse_product_description_unproven");
      }
      return matching[0].name as string;
    };
    const payments = await this.prisma.paymentIntent.findMany({ where: { merchantId: host, marketplaceFunding: { is: { hostMerchantId: host } },
      OR: [{ commerceOrderId: { in: aliases } }, { providerPaymentId: { in: aliases } }] }, include: { marketplaceFunding: true }, take: 2 });
    if (payments.length) {
      if (payments.length !== 1 || payments[0].currency !== "BRL") throw new ConflictException("return_original_order_unproven");
      const plan = payments[0].marketplaceFunding!, instructions = plan.instructions as unknown as FrozenMarketplaceFunding;
      if (fundingHash(instructions) !== plan.instructionsHash || !plan.providerPaymentId) throw new ConflictException("return_original_order_unproven");
      const cross = await this.prisma.crossStoreLineItem.findMany({ where: { hostMerchantId: host, orderId: plan.providerPaymentId } });
      const identities = [...cross.map(line => ({ variantId: line.sourceVariantId, merchantId: line.sellerMerchantId,
        quantity: line.quantity, unitCents: line.unitPriceCents, lineItemId: line.id })), ...(instructions.hostStockItems ?? []).map(line => {
          const frozen = instructions.lines.find(row => row.lineItemId === line.lineItemId);
          return { variantId: line.variantId, merchantId: host, quantity: line.quantity,
            unitCents: frozen ? frozen.grossAmountCents / line.quantity : NaN, lineItemId: line.lineItemId };
        })];
      const selected = ret.items.map(item => {
        const matches = identities.filter(line => line.variantId === item.variantId), line = matches[0];
        const frozen = instructions.lines.find(row => row.lineItemId === line?.lineItemId);
        if (matches.length !== 1 || !frozen || frozen.sellerMerchantId !== line.merchantId || frozen.grossAmountCents !== line.quantity * line.unitCents ||
          item.quantity > line.quantity || !Number.isSafeInteger(line.unitCents) || line.unitCents < 0) throw new ConflictException("return_items_unproven");
        return { origin: line.merchantId, cents: item.quantity * line.unitCents,
          product: { name: productName(item.variantId, line.unitCents), quantity: item.quantity, unitary_value: line.unitCents / 100 } };
      });
      const sources: Source[] = [];
      for (const origin of [...new Set(selected.map(line => line.origin))].sort()) {
        const originals = await this.prisma.marketplaceShipmentJournal.findMany({ where: { hostMerchantId: host, fundingPlanId: plan.paymentIntentId,
          originMerchantId: origin }, orderBy: { volumeIndex: "asc" }, take: 101 });
        if (!originals.length || originals.length > 100) throw new ConflictException("return_reverse_original_label_unproven");
        const records = originals.map(verifyMarketplaceShipmentRecord), first = records[0];
        if (records.some(row => !row.generatedAt || !row.request.accountIdentity || !row.carrierOrderId || row.cancellationStatus ||
          fundingHash(row.request.body.from) !== fundingHash(first.request.body.from) || fundingHash(row.request.body.to) !== fundingHash(first.request.body.to))) throw new ConflictException("return_reverse_original_label_unproven");
        const merchant = await this.prisma.merchant.findUnique({ where: { id: origin }, select: { name: true } });
        sources.push({ originMerchantId: origin, originName: merchant?.name || "Loja participante", originalOrderId: first.carrierOrderId!,
          accountIdentity: first.request.accountIdentity!, insuranceCents: selected.filter(line => line.origin === origin).reduce((sum, line) => sum + line.cents, 0),
          products: selected.filter(line => line.origin === origin).map(line => line.product), sessionId: completed[0]?.sessionId ?? plan.paymentIntentId });
      }
      return sources;
    }
    if (completed.length !== 1 || completed[0].currency !== "BRL") throw new ConflictException("return_original_order_unproven");
    const order = completed[0], items = Array.isArray(order.lineItemsJson) ? order.lineItemsJson.map(object) : [];
    const insuranceCents = ret.items.reduce((sum, returned) => {
      const matching = items.filter(item => item.variantId === returned.variantId), quantity = matching.reduce((n, item) => n + item.quantity, 0);
      if (!matching.length || returned.quantity > quantity || matching.some(item => !Number.isSafeInteger(item.quantity) || item.quantity < 1 ||
        !Number.isSafeInteger(item.unitPriceCents) || item.unitPriceCents < 0 || item.unitPriceCents !== matching[0].unitPriceCents)) throw new ConflictException("return_items_unproven");
      return sum + returned.quantity * matching[0].unitPriceCents;
    }, 0);
    const shipment = await this.prisma.shipment.findFirst({ where: { merchantId: host, externalOrderId: order.externalOrderId, carrier: "melhor-envio" } });
    if (!shipment) throw new ConflictException("return_reverse_original_label_unproven");
    const receipts = await this.prisma.trackingEvent.findMany({ where: { merchantId: host, shipmentId: shipment.id,
      id: { startsWith: "shipping_label_purchase_" } }, take: 2 }), receipt = object(receipts[0]?.carrierRaw);
    if (receipts.length !== 1 || receipt.kind !== "zyon_native_label_purchase" || receipt.external_order_id !== order.externalOrderId ||
      !receipt.carrier_order_id || !receipt.account_identity) throw new ConflictException("return_reverse_original_label_unproven");
    const merchant = await this.prisma.merchant.findUnique({ where: { id: host }, select: { name: true } });
    return [{ originMerchantId: host, originName: merchant?.name ?? "Loja", originalOrderId: receipt.carrier_order_id,
      accountIdentity: receipt.account_identity, insuranceCents, sessionId: order.sessionId,
      products: ret.items.map(item => { const original = items.find(row => row.variantId === item.variantId)!;
        return { name: productName(item.variantId, original.unitPriceCents), quantity: item.quantity, unitary_value: original.unitPriceCents / 100 }; }) }];
  }
}
