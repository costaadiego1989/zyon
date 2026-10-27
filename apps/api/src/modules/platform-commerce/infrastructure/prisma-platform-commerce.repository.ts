import { Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import type {
  PlatformCommerceAudit,
  PlatformCommerceRepository,
  PlatformMerchantDetail,
  PlatformMerchantRank,
  PlatformOrderDetail,
  PlatformOrderQuery,
  PlatformOrderSummary,
} from "../domain/ports/platform-commerce.repository.port.js";

const SALES_EXCLUDED_STATUSES = ["cancelled", "refunded"];
const OPEN_RECEIVABLE_STATUSES = ["open", "pending", "due", "overdue"];
const PRESENTATION_TIME_ZONE = "America/Sao_Paulo";

@Injectable()
export class PrismaPlatformCommerceRepository implements PlatformCommerceRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async listOrders(query: PlatformOrderQuery): Promise<{ items: PlatformOrderSummary[]; nextCursor?: string }> {
    const where = await this.orderWhere(query);
    const rows = await this.prisma.completedOrder.findMany({
      where,
      orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      select: orderSelect(),
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const items = await this.summaries(page);
    return { items, ...(hasMore && page.length ? { nextCursor: page[page.length - 1].id } : {}) };
  }

  async findOrder(id: string): Promise<PlatformOrderDetail | undefined> {
    const row = await this.prisma.completedOrder.findUnique({ where: { id }, select: orderSelect() });
    if (!row) return undefined;
    const [summary] = await this.summaries([row]);
    if (!summary) return undefined;
    const payment = await this.paymentFor(row.merchantId, row.sessionId);
    const shipment = await this.shipmentFor(row.merchantId, row.externalOrderId);
    const customer = customerFrom(row.session.customer);
    const address = addressFrom(row.session.shipping);
    return {
      ...summary,
      ...(customer ? { customer } : {}),
      items: lineItemsFrom(row.lineItemsJson),
      payment: {
        ...summary.payment,
        ...(payment ? { amountMinor: payment.approvedAmountCents ?? payment.amountCents, ...(maskReference(payment.providerPaymentId) ? { providerPaymentReference: maskReference(payment.providerPaymentId) } : {}), updatedAt: payment.updatedAt } : {}),
      },
      shipping: {
        ...summary.shipping,
        ...(row.shippingCents === null ? {} : { amountMinor: row.shippingCents }),
        ...(shipment ? { trackingCode: shipment.trackingCode, ...(shipment.trackingUrl ? { trackingUrl: shipment.trackingUrl } : {}), ...(shipment.estimatedEta ? { estimatedEta: shipment.estimatedEta } : {}), ...(shipment.deliveredAt ? { deliveredAt: shipment.deliveredAt } : {}) } : {}),
        ...(address ? { address } : {}),
      },
      ...(row.cancelledAt ? { cancelledAt: row.cancelledAt } : {}),
      ...(row.cancellationReason ? { cancellationReason: row.cancellationReason } : {}),
    };
  }

  async merchantDetail(merchantId: string, period: { from: Date; to: Date }): Promise<PlatformMerchantDetail | undefined> {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { id: true, name: true, storeSlug: true, storeCategory: true, plan: true, billingAccountMerchantId: true, createdAt: true } });
    if (!merchant) return undefined;
    const billingMerchantId = merchant.billingAccountMerchantId ?? merchant.id;
    const salesWhere: Prisma.CompletedOrderWhereInput = { merchantId, status: { notIn: SALES_EXCLUDED_STATUSES } };
    const periodWhere: Prisma.CompletedOrderWhereInput = { ...salesWhere, completedAt: { gte: period.from, lt: period.to } };
    const [allTime, periodRows, billing, receivables, chat, voice, recentRows] = await Promise.all([
      this.prisma.completedOrder.aggregate({ where: salesWhere, _count: { _all: true }, _sum: { orderTotal: true } }),
      this.prisma.completedOrder.findMany({ where: periodWhere, select: { completedAt: true, orderTotal: true }, orderBy: { completedAt: "asc" } }),
      this.prisma.merchantBillingSubscription.findUnique({ where: { merchantId: billingMerchantId }, select: { status: true, provider: true, planKey: true, billingAmountCents: true, billingCycle: true, currentPeriodEnd: true } }),
      this.prisma.billingReceivable.findMany({ where: { merchantId: billingMerchantId, status: { in: OPEN_RECEIVABLE_STATUSES } }, select: { status: true, dueAt: true }, orderBy: { dueAt: "asc" } }),
      this.aiAggregate(merchantId, "chat", period),
      this.aiAggregate(merchantId, "voice", period),
      this.prisma.completedOrder.findMany({ where: { merchantId }, select: orderSelect(), orderBy: [{ completedAt: "desc" }, { id: "desc" }], take: 5 }),
    ]);
    const recentOrders = await this.summaries(recentRows);
    const series = salesSeries(periodRows);
    return {
      merchant: { id: merchant.id, name: merchant.name, ...(merchant.storeSlug ? { storeSlug: merchant.storeSlug } : {}), ...(merchant.storeCategory ? { storeCategory: merchant.storeCategory } : {}), plan: merchant.plan, createdAt: merchant.createdAt },
      period,
      orders: { allTimeCount: allTime._count._all, allTimeTotalMinor: minor(allTime._sum.orderTotal), periodCount: periodRows.length, periodTotalMinor: periodRows.reduce((total, row) => total + minor(row.orderTotal), 0), series },
      billing: {
        ...(billing?.status ? { status: billing.status } : {}),
        ...(billing?.provider ? { provider: billing.provider } : {}),
        ...(billing?.planKey ? { planKey: billing.planKey } : {}),
        ...(billing?.billingAmountCents === null || billing?.billingAmountCents === undefined ? {} : { amountMinor: billing.billingAmountCents }),
        ...(billing?.billingCycle ? { cycle: billing.billingCycle } : {}),
        ...(billing?.currentPeriodEnd ? { currentPeriodEnd: billing.currentPeriodEnd } : {}),
        overdueCount: receivables.filter(item => item.status === "overdue").length,
        openReceivableCount: receivables.length,
        ...(receivables.find(item => item.dueAt)?.dueAt ? { nextDueAt: receivables.find(item => item.dueAt)?.dueAt as Date } : {}),
      },
      ai: { chatTokens: chat.totalTokens, voiceTokens: voice.totalTokens, chatKnownCostMicros: chat.knownCostMicros, voiceKnownCostMicros: voice.knownCostMicros, knownCostMicros: chat.knownCostMicros + voice.knownCostMicros, unpricedEvents: chat.unpricedEvents + voice.unpricedEvents },
      recentOrders,
    };
  }

  async merchantRanking(input: { from: Date; to: Date; sort: "sales" | "ai_cost" | "tokens"; limit: number }): Promise<PlatformMerchantRank[]> {
    const salesWhere: Prisma.CompletedOrderWhereInput = { status: { notIn: SALES_EXCLUDED_STATUSES }, completedAt: { gte: input.from, lt: input.to } };
    const aiWhere = { startedAt: { gte: input.from, lt: input.to }, executionStatus: "succeeded" } as const;
    const [salesRows, aiRows] = await Promise.all([
      this.prisma.completedOrder.groupBy({ by: ["merchantId"], where: salesWhere, _count: { _all: true }, _sum: { orderTotal: true } }),
      this.prisma.aiUsageEvent.groupBy({ by: ["merchantId", "costStatus"], where: aiWhere, _count: { _all: true }, _sum: { totalTokens: true, costMicros: true } }),
    ]);
    const ids = new Set<string>([...salesRows.map(row => row.merchantId), ...aiRows.map(row => row.merchantId)]);
    if (!ids.size) return [];
    const merchants = await this.prisma.merchant.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true, storeSlug: true } });
    const values = new Map<string, Omit<PlatformMerchantRank, "rank" | "merchant">>();
    for (const row of salesRows) values.set(row.merchantId, { sales: { orderCount: row._count._all, totalMinor: minor(row._sum.orderTotal) }, ai: { totalTokens: 0n, knownCostMicros: 0n, unpricedEvents: 0 } });
    for (const row of aiRows) {
      const current = values.get(row.merchantId) ?? { sales: { orderCount: 0, totalMinor: 0 }, ai: { totalTokens: 0n, knownCostMicros: 0n, unpricedEvents: 0 } };
      current.ai.totalTokens += BigInt(row._sum.totalTokens ?? 0);
      if (row.costStatus === "unpriced") current.ai.unpricedEvents += row._count._all;
      else current.ai.knownCostMicros += row._sum.costMicros ?? 0n;
      values.set(row.merchantId, current);
    }
    const ranked = merchants.map(merchant => ({ merchant: { id: merchant.id, name: merchant.name, ...(merchant.storeSlug ? { storeSlug: merchant.storeSlug } : {}) }, ...(values.get(merchant.id) ?? { sales: { orderCount: 0, totalMinor: 0 }, ai: { totalTokens: 0n, knownCostMicros: 0n, unpricedEvents: 0 } }) }));
    ranked.sort((left, right) => compareRanks(left, right, input.sort));
    return ranked.slice(0, input.limit).map((item, index) => ({ ...item, rank: index + 1 }));
  }

  async recordRead(input: PlatformCommerceAudit): Promise<void> {
    const permission = input.action === "merchant_detail" ? "platform:merchants:read" : "platform:orders:read";
    await this.prisma.platformAuditEvent.create({ data: { actorOperatorId: input.actorOperatorId, action: `platform.commerce.${input.action}.read`, permission, environment: input.environment, targetType: input.action === "merchant_detail" ? "platform_merchant" : "platform_commerce", ...(input.targetId ? { targetId: input.targetId } : {}), correlationId: input.correlationId, outcome: "succeeded", details: input.details as Prisma.InputJsonValue } });
  }

  private async orderWhere(query: PlatformOrderQuery): Promise<Prisma.CompletedOrderWhereInput> {
    const where: Prisma.CompletedOrderWhereInput = {
      ...(query.merchantId ? { merchantId: query.merchantId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...((query.from || query.to) ? { completedAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lt: query.to } : {}) } } : {}),
    };
    if (!query.query) return where;
    const merchants = await this.prisma.merchant.findMany({ where: { OR: [{ id: { contains: query.query } }, { name: { contains: query.query, mode: "insensitive" } }, { storeSlug: { contains: query.query, mode: "insensitive" } }] }, select: { id: true } });
    return { ...where, OR: [{ id: { contains: query.query } }, { externalOrderId: { contains: query.query } }, ...(merchants.length ? [{ merchantId: { in: merchants.map(merchant => merchant.id) } }] : [])] };
  }

  private async summaries(rows: any[]): Promise<PlatformOrderSummary[]> {
    if (!rows.length) return [];
    const merchantIds = [...new Set(rows.map(row => row.merchantId))];
    const [merchants, payments, shipments] = await Promise.all([
      this.prisma.merchant.findMany({ where: { id: { in: merchantIds } }, select: { id: true, name: true, storeSlug: true } }),
      this.prisma.paymentIntent.findMany({ where: { OR: rows.map(row => ({ merchantId: row.merchantId, sessionId: row.sessionId })) }, select: { merchantId: true, sessionId: true, method: true, status: true, providerPaymentId: true, approvedAmountCents: true, amountCents: true, updatedAt: true }, orderBy: { updatedAt: "desc" } }),
      this.prisma.shipment.findMany({ where: { OR: rows.map(row => ({ merchantId: row.merchantId, externalOrderId: row.externalOrderId })) }, select: { merchantId: true, externalOrderId: true, carrier: true, status: true, trackingCode: true, trackingUrl: true, estimatedEta: true, deliveredAt: true } }),
    ]);
    const merchantById = new Map(merchants.map(merchant => [merchant.id, merchant]));
    const paymentByKey = new Map<string, any>();
    for (const payment of payments) { const paymentKey = key(payment.merchantId, payment.sessionId); if (!paymentByKey.has(paymentKey)) paymentByKey.set(paymentKey, payment); }
    const shipmentByKey = new Map(shipments.map(shipment => [key(shipment.merchantId, shipment.externalOrderId), shipment]));
    return rows.map(row => summaryFrom(row, merchantById.get(row.merchantId), paymentByKey.get(key(row.merchantId, row.sessionId)), shipmentByKey.get(key(row.merchantId, row.externalOrderId))));
  }

  private async paymentFor(merchantId: string, sessionId: string) {
    const payments = await this.prisma.paymentIntent.findMany({ where: { merchantId, sessionId }, select: { method: true, status: true, providerPaymentId: true, approvedAmountCents: true, amountCents: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 1 });
    return payments[0];
  }
  private async shipmentFor(merchantId: string, externalOrderId: string) { return this.prisma.shipment.findUnique({ where: { merchantId_externalOrderId: { merchantId, externalOrderId } }, select: { carrier: true, status: true, trackingCode: true, trackingUrl: true, estimatedEta: true, deliveredAt: true } }); }
  private async aiAggregate(merchantId: string, channel: "chat" | "voice", period: { from: Date; to: Date }) {
    const where = { merchantId, channel, startedAt: { gte: period.from, lt: period.to }, executionStatus: "succeeded" } as const;
    const [known, unpriced] = await Promise.all([this.prisma.aiUsageEvent.aggregate({ where: { ...where, costStatus: { in: ["estimated", "provider_reported", "reconciled"] } }, _sum: { totalTokens: true, costMicros: true } }), this.prisma.aiUsageEvent.aggregate({ where: { ...where, costStatus: "unpriced" }, _count: { _all: true }, _sum: { totalTokens: true } })]);
    return { totalTokens: BigInt(known._sum.totalTokens ?? 0) + BigInt(unpriced._sum.totalTokens ?? 0), knownCostMicros: known._sum.costMicros ?? 0n, unpricedEvents: unpriced._count._all };
  }
}

function orderSelect() { return { id: true, merchantId: true, sessionId: true, externalOrderId: true, orderTotal: true, currency: true, status: true, lineItemsJson: true, shippingCents: true, completedAt: true, cancelledAt: true, cancellationReason: true, session: { select: { customer: true, shipping: true } } } as const; }
function summaryFrom(row: any, merchant: any, payment: any, shipment: any): PlatformOrderSummary { return { id: row.id, externalOrderId: row.externalOrderId, merchant: { id: row.merchantId, name: merchant?.name ?? "Empresa indisponível", ...(merchant?.storeSlug ? { storeSlug: merchant.storeSlug } : {}) }, totalMinor: minor(row.orderTotal), currency: row.currency, status: row.status, payment: { method: payment?.method ?? "Não informado", status: payment?.status ?? "Não informado", ...(providerFrom(payment?.providerPaymentId) ? { provider: providerFrom(payment?.providerPaymentId) } : {}) }, shipping: { ...(shipment?.status ? { status: shipment.status } : {}), ...(shipment?.carrier ? { carrier: shipment.carrier } : {}) }, completedAt: row.completedAt }; }
function customerFrom(value: unknown) { const row = object(value); if (!row) return undefined; const result = { ...(text(row.name) ?? text(row.fullName) ? { name: text(row.name) ?? text(row.fullName) } : {}), ...(text(row.email) ? { email: text(row.email) } : {}), ...(text(row.phone) ?? text(row.phoneNumber) ?? text(row.whatsapp) ? { phone: text(row.phone) ?? text(row.phoneNumber) ?? text(row.whatsapp) } : {}) }; return Object.keys(result).length ? result : undefined; }
function addressFrom(value: unknown) { const raw = object(value); const row = object(raw?.address) ?? raw; if (!row) return undefined; const result = { ...(text(row.street) ?? text(row.address) ?? text(row.line1) ? { street: text(row.street) ?? text(row.address) ?? text(row.line1) } : {}), ...(text(row.number) ? { number: text(row.number) } : {}), ...(text(row.complement) ?? text(row.line2) ? { complement: text(row.complement) ?? text(row.line2) } : {}), ...(text(row.neighborhood) ? { neighborhood: text(row.neighborhood) } : {}), ...(text(row.city) ? { city: text(row.city) } : {}), ...(text(row.state) ? { state: text(row.state) } : {}), ...(text(row.postalCode) ?? text(row.zipCode) ?? text(row.zip) ? { postalCode: text(row.postalCode) ?? text(row.zipCode) ?? text(row.zip) } : {}) }; return Object.keys(result).length ? result : undefined; }
function lineItemsFrom(value: unknown) { if (!Array.isArray(value)) return []; return value.slice(0, 100).flatMap(item => { const row = object(item); const name = text(row?.name) ?? text(row?.productName) ?? text(row?.title); const quantity = number(row?.quantity) ?? 1; if (!row || !name || quantity < 1) return []; return [{ name, ...(text(row.sku) ? { sku: text(row.sku) } : {}), ...(text(row.variant) ?? text(row.variantName) ? { variant: text(row.variant) ?? text(row.variantName) } : {}), quantity, ...(number(row.unitPriceCents) ?? number(row.unit_price_cents) ? { unitPriceMinor: number(row.unitPriceCents) ?? number(row.unit_price_cents) } : {}), ...(number(row.totalCents) ?? number(row.lineTotalCents) ? { totalMinor: number(row.totalCents) ?? number(row.lineTotalCents) } : {}) }]; }); }
function salesSeries(rows: Array<{ completedAt: Date; orderTotal: { toString(): string } | null }>) { const values = new Map<string, { orderCount: number; totalMinor: number }>(); for (const row of rows) { const date = dateInSaoPaulo(row.completedAt); const current = values.get(date) ?? { orderCount: 0, totalMinor: 0 }; current.orderCount += 1; current.totalMinor += minor(row.orderTotal); values.set(date, current); } return [...values.entries()].map(([date, value]) => ({ date, ...value })); }
function dateInSaoPaulo(date: Date) { const values = new Intl.DateTimeFormat("en-CA", { timeZone: PRESENTATION_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date); const get = (kind: Intl.DateTimeFormatPartTypes) => values.find(item => item.type === kind)?.value ?? ""; return `${get("year")}-${get("month")}-${get("day")}`; }
function compareRanks(left: Omit<PlatformMerchantRank, "rank">, right: Omit<PlatformMerchantRank, "rank">, sort: "sales" | "ai_cost" | "tokens") { if (sort === "ai_cost") return compareBigint(right.ai.knownCostMicros, left.ai.knownCostMicros) || right.sales.totalMinor - left.sales.totalMinor; if (sort === "tokens") return compareBigint(right.ai.totalTokens, left.ai.totalTokens) || right.sales.totalMinor - left.sales.totalMinor; return right.sales.totalMinor - left.sales.totalMinor || compareBigint(right.ai.knownCostMicros, left.ai.knownCostMicros); }
function compareBigint(left: bigint, right: bigint) { return left === right ? 0 : left > right ? 1 : -1; }
function key(first: string, second: string) { return `${first}:${second}`; }
function minor(value: { toString(): string } | null | undefined) { const parsed = Number(value?.toString() ?? "0"); return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0; }
function providerFrom(value: unknown) { if (typeof value !== "string") return undefined; if (value.startsWith("pi_")) return "Stripe"; if (value.startsWith("pay_")) return "Asaas"; if (value.startsWith("mp_")) return "Mercado Pago"; return undefined; }
function maskReference(value: unknown) { if (typeof value !== "string" || value.length < 5) return undefined; return `••••${value.slice(-4)}`; }
function object(value: unknown): Record<string, unknown> | undefined { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined; }
function text(value: unknown) { return typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : undefined; }
function number(value: unknown) { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined; }
