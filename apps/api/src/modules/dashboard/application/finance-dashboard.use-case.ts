import { BadRequestException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";

const MAX_PERIOD_DAYS = 366;
const MAX_PAGE_SIZE = 100;
const FINANCE_TIME_ZONE = "America/Sao_Paulo";

export type FinanceTransactionKind = "sale" | "refund";

export interface FinancePeriodInput {
  from?: unknown;
  to?: unknown;
}

export interface FinanceTransactionsInput extends FinancePeriodInput {
  page?: unknown;
  limit?: unknown;
  type?: unknown;
  method?: unknown;
  q?: unknown;
}

export interface FinancePeriod {
  from: string;
  to: string;
  time_zone: string;
}

export interface FinanceTransaction {
  id: string;
  kind: FinanceTransactionKind;
  occurred_at: string;
  amount_brl: number;
  currency: "BRL";
  order_reference: string;
  payment_method: string | null;
  status: string;
  payment_intent_id: string | null;
}

export interface FinanceSummary {
  period: FinancePeriod;
  generated_at: string;
  currency: "BRL";
  metrics: {
    completed_orders_gross_brl: number;
    completed_orders: number;
    average_completed_order_value_brl: number;
    refunds_confirmed_brl: number;
  };
  series: Array<{ date: string; completed_orders_gross_brl: number; refunds_brl: number }>;
  payment_methods: Array<{ method: string; completed_orders_gross_brl: number; orders: number }>;
  scope_note: string;
}

export interface FinanceTransactionsPage {
  period: FinancePeriod;
  generated_at: string;
  currency: "BRL";
  page: number;
  limit: number;
  total: number;
  items: FinanceTransaction[];
}

type PeriodBounds = FinancePeriod & { start: Date; endExclusive: Date };

type Movement = FinanceTransaction & { sortId: string };

const CONFIRMED_PAYMENT_STATUSES = new Set([
  "approved",
  "paid",
  "succeeded",
  "captured",
  "refunded",
]);

/**
 * Financial read model for the merchant dashboard.
 *
 * It deliberately treats CompletedOrder and provider-confirmed refunds as
 * different movements. A fully refunded order therefore remains visible as a
 * sale and a refund, which explains the gross figures without inventing a
 * provider payout balance or platform fee.
 */
export class FinanceDashboardUseCase {
  constructor(private readonly prisma: PrismaClient) {}

  async summary(merchantId: string, input: FinancePeriodInput): Promise<FinanceSummary> {
    const period = normalizePeriod(input);
    const movements = await this.loadMovements(merchantId, period);
    const completedOrders = movements.filter((movement) => movement.kind === "sale");
    const refunds = movements.filter((movement) => movement.kind === "refund");

    const completedOrdersGross = sumBrl(completedOrders.map((movement) => movement.amount_brl));
    const refundsConfirmed = sumBrl(refunds.map((movement) => Math.abs(movement.amount_brl)));
    const byDate = new Map<string, { completed_orders_gross_brl: number; refunds_brl: number }>();

    for (const movement of movements) {
      const date = formatSaoPauloDate(new Date(movement.occurred_at));
      const current = byDate.get(date) ?? { completed_orders_gross_brl: 0, refunds_brl: 0 };
      if (movement.kind === "sale") {
        current.completed_orders_gross_brl = preciseBrl(current.completed_orders_gross_brl + movement.amount_brl);
      }
      else current.refunds_brl = preciseBrl(current.refunds_brl + Math.abs(movement.amount_brl));
      byDate.set(date, current);
    }

    const byMethod = new Map<string, { completed_orders_gross_brl: number; orders: number }>();
    for (const completedOrder of completedOrders) {
      const method = normalizePaymentMethod(completedOrder.payment_method);
      const current = byMethod.get(method) ?? { completed_orders_gross_brl: 0, orders: 0 };
      current.completed_orders_gross_brl = preciseBrl(
        current.completed_orders_gross_brl + completedOrder.amount_brl,
      );
      current.orders += 1;
      byMethod.set(method, current);
    }

    return {
      period: publicPeriod(period),
      generated_at: new Date().toISOString(),
      currency: "BRL",
      metrics: {
        completed_orders_gross_brl: completedOrdersGross,
        completed_orders: completedOrders.length,
        average_completed_order_value_brl:
          completedOrders.length === 0 ? 0 : preciseBrl(completedOrdersGross / completedOrders.length),
        refunds_confirmed_brl: refundsConfirmed,
      },
      series: Array.from(byDate.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, values]) => ({ date, ...values })),
      payment_methods: Array.from(byMethod.entries())
        .map(([method, values]) => ({ method, ...values }))
        .sort(
          (a, b) =>
            b.completed_orders_gross_brl - a.completed_orders_gross_brl || a.method.localeCompare(b.method),
        ),
      scope_note:
        "Valores brutos de pedidos concluídos e reembolsos confirmados. Eles não representam saldo liquidado, valor disponível ou repasse confirmado; esses dados dependem da conciliação do provedor.",
    };
  }

  async transactions(merchantId: string, input: FinanceTransactionsInput): Promise<FinanceTransactionsPage> {
    const period = normalizePeriod(input);
    const page = parseBoundedInteger(input.page, 1, 1, 10_000, "page");
    const limit = parseBoundedInteger(input.limit, 25, 1, MAX_PAGE_SIZE, "limit");
    const type = parseTransactionType(input.type);
    const method = parseOptionalText(input.method, "method", 80)?.toLowerCase();
    const query = parseOptionalText(input.q, "q", 160)?.toLowerCase();
    const movements = await this.loadMovements(merchantId, period);
    const filtered = movements.filter((movement) => {
      if (type && movement.kind !== type) return false;
      if (method && canonicalPaymentMethod(movement.payment_method) !== canonicalPaymentMethod(method)) return false;
      if (query) {
        const haystack = `${movement.order_reference} ${movement.payment_method ?? ""} ${movement.status}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
    const start = (page - 1) * limit;

    return {
      period: publicPeriod(period),
      generated_at: new Date().toISOString(),
      currency: "BRL",
      page,
      limit,
      total: filtered.length,
      items: filtered.slice(start, start + limit).map(({ sortId: _sortId, ...movement }) => movement),
    };
  }

  async exportCsv(merchantId: string, input: FinanceTransactionsInput): Promise<string> {
    const period = normalizePeriod(input);
    const type = parseTransactionType(input.type);
    const method = parseOptionalText(input.method, "method", 80)?.toLowerCase();
    const query = parseOptionalText(input.q, "q", 160)?.toLowerCase();
    const movements = (await this.loadMovements(merchantId, period)).filter((movement) => {
      if (type && movement.kind !== type) return false;
      if (method && canonicalPaymentMethod(movement.payment_method) !== canonicalPaymentMethod(method)) return false;
      if (!query) return true;
      return `${movement.order_reference} ${movement.payment_method ?? ""} ${movement.status}`.toLowerCase().includes(query);
    });

    const generatedAt = new Date().toISOString();
    const lines = [
      ["Relatório de pedidos e reembolsos", "", "", "", "", "", ""],
      ["Período", `${period.from} a ${period.to}`, "Fuso", period.time_zone, "Moeda", "BRL", ""],
      ["Gerado em", generatedAt, "", "", "", "", ""],
      [],
      ["Data", "Tipo", "Pedido", "Método", "Valor (BRL)", "Situação", "Referência do pagamento"],
      ...movements.map((movement) => [
        movement.occurred_at,
        movement.kind === "sale" ? "Pedido concluído" : "Reembolso",
        movement.order_reference,
        normalizePaymentMethod(movement.payment_method),
        formatCsvBrl(movement.amount_brl),
        movement.status,
        movement.payment_intent_id ?? "",
      ]),
    ];
    // The amount remains numeric in spreadsheets, including a leading minus on
    // refunds. All identifiers and textual values keep formula protection.
    const csvLines = lines.map((line, rowIndex) =>
      line.map((value, columnIndex) => escapeCsvCell(value, rowIndex < 5 || columnIndex !== 4)).join(";"),
    );
    return `\uFEFF${csvLines.join("\r\n")}\r\n`;
  }

  private async loadMovements(merchantId: string, period: PeriodBounds): Promise<Movement[]> {
    const [orders, refunds, providerRefunds] = await Promise.all([
      this.prisma.completedOrder.findMany({
        where: {
          merchantId,
          completedAt: { gte: period.start, lt: period.endExclusive },
          status: { notIn: ["cancelled", "canceled"] },
        },
        select: {
          id: true,
          sessionId: true,
          externalOrderId: true,
          orderTotal: true,
          currency: true,
          status: true,
          completedAt: true,
        },
        orderBy: [{ completedAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.returnRefund.findMany({
        where: {
          status: "COMPLETED",
          processedAt: { gte: period.start, lt: period.endExclusive },
          return: { merchantId },
        },
        select: {
          id: true,
          paymentIntentId: true,
          amountInCents: true,
          status: true,
          processedAt: true,
          return: { select: { orderId: true } },
        },
        orderBy: [{ processedAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.paymentIntent.findMany({
        where: {
          merchantId,
          status: "refunded",
          updatedAt: { gte: period.start, lt: period.endExclusive },
        },
        select: { id: true, sessionId: true, method: true, status: true, updatedAt: true },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      }),
    ]);

    const sessionIds = orders.map((order) => order.sessionId);
    const providerRefundSessionIds = providerRefunds
      .map((payment) => payment.sessionId)
      .filter((sessionId) => !sessionIds.includes(sessionId));
    const providerRefundOrders = providerRefundSessionIds.length > 0
      ? await this.prisma.completedOrder.findMany({
          where: {
            merchantId,
            sessionId: { in: providerRefundSessionIds },
            status: { notIn: ["cancelled", "canceled"] },
          },
          select: {
            id: true,
            sessionId: true,
            externalOrderId: true,
            orderTotal: true,
            currency: true,
            status: true,
            completedAt: true,
          },
          orderBy: [{ completedAt: "desc" }, { id: "desc" }],
        })
      : [];
    const intentIds = refunds.flatMap((refund) => refund.paymentIntentId ? [refund.paymentIntentId] : []);
    const paymentIntents = sessionIds.length > 0 || intentIds.length > 0
      ? await this.prisma.paymentIntent.findMany({
          where: {
            merchantId,
            OR: [
              ...(sessionIds.length > 0 ? [{ sessionId: { in: sessionIds } }] : []),
              ...(intentIds.length > 0 ? [{ id: { in: intentIds } }] : []),
            ],
          },
          select: { id: true, sessionId: true, method: true, status: true, updatedAt: true },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        })
      : [];

    const paymentBySession = new Map<string, (typeof paymentIntents)[number]>();
    const paymentById = new Map<string, (typeof paymentIntents)[number]>();
    for (const payment of paymentIntents) {
      paymentById.set(payment.id, payment);
      const existing = paymentBySession.get(payment.sessionId);
      if (!existing || paymentRank(payment.status) > paymentRank(existing.status)) {
        paymentBySession.set(payment.sessionId, payment);
      }
    }
    const orderBySession = new Map<string, (typeof orders)[number]>();
    for (const order of [...orders, ...providerRefundOrders]) {
      if (!orderBySession.has(order.sessionId)) orderBySession.set(order.sessionId, order);
    }
    const confirmedRefundPaymentIds = new Set(
      refunds.flatMap((refund) => refund.paymentIntentId ? [refund.paymentIntentId] : []),
    );
    const confirmedRefundOrderReferences = new Set(refunds.map((refund) => refund.return.orderId));

    const movements: Movement[] = [
      ...orders
        .filter((order) => order.currency.toUpperCase() === "BRL")
        .map((order) => {
          const payment = paymentBySession.get(order.sessionId);
          return {
            id: `sale:${order.id}`,
            sortId: order.id,
            kind: "sale" as const,
            occurred_at: order.completedAt.toISOString(),
            amount_brl: decimalToBrl(order.orderTotal),
            currency: "BRL" as const,
            order_reference: order.externalOrderId,
            payment_method: payment?.method ?? null,
            status: order.status,
            payment_intent_id: payment?.id ?? null,
          };
        }),
      ...refunds.map((refund) => {
        const payment = refund.paymentIntentId ? paymentById.get(refund.paymentIntentId) : undefined;
        return {
          id: `refund:${refund.id}`,
          sortId: refund.id,
          kind: "refund" as const,
          occurred_at: refund.processedAt!.toISOString(),
          amount_brl: preciseBrl(-(refund.amountInCents / 100)),
          currency: "BRL" as const,
          order_reference: refund.return.orderId,
          payment_method: payment?.method ?? null,
          status: refund.status,
          payment_intent_id: refund.paymentIntentId ?? null,
        };
      }),
      ...providerRefunds.flatMap((payment) => {
        const order = orderBySession.get(payment.sessionId);
        if (
          !order ||
          order.currency.toUpperCase() !== "BRL" ||
          confirmedRefundPaymentIds.has(payment.id) ||
          confirmedRefundOrderReferences.has(order.externalOrderId)
        ) {
          return [];
        }
        return [{
          id: `provider-refund:${payment.id}`,
          sortId: payment.id,
          kind: "refund" as const,
          occurred_at: payment.updatedAt.toISOString(),
          // Payment intents can include a buyer-facing fee. Financeiro reports
          // the store order total, the same basis used for the sale movement.
          amount_brl: preciseBrl(-decimalToBrl(order.orderTotal)),
          currency: "BRL" as const,
          order_reference: order.externalOrderId,
          payment_method: payment.method,
          status: payment.status,
          payment_intent_id: payment.id,
        }];
      }),
    ];

    return movements.sort((a, b) =>
      b.occurred_at.localeCompare(a.occurred_at) ||
      a.kind.localeCompare(b.kind) ||
      b.sortId.localeCompare(a.sortId),
    );
  }
}

function normalizePeriod(input: FinancePeriodInput): PeriodBounds {
  const today = formatSaoPauloDate(new Date());
  const defaultFrom = subtractCalendarDays(today, 29);
  const from = parseCalendarDate(input.from, "from") ?? defaultFrom;
  const to = parseCalendarDate(input.to, "to") ?? today;
  if (from > to) throw new BadRequestException("finance_invalid_period");
  const start = startOfSaoPauloDay(from);
  const endExclusive = startOfSaoPauloDay(addCalendarDays(to, 1));
  const days = Math.round((endExclusive.getTime() - start.getTime()) / 86_400_000);
  if (days > MAX_PERIOD_DAYS) throw new BadRequestException("finance_period_too_large");
  return { from, to, time_zone: FINANCE_TIME_ZONE, start, endExclusive };
}

function publicPeriod(period: PeriodBounds): FinancePeriod {
  return { from: period.from, to: period.to, time_zone: period.time_zone };
}

function parseCalendarDate(value: unknown, field: string): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`finance_invalid_${field}`);
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    throw new BadRequestException(`finance_invalid_${field}`);
  }
  return value;
}

function parseBoundedInteger(value: unknown, fallback: number, min: number, max: number, field: string): number {
  if (value == null || value === "") return fallback;
  if (typeof value !== "string" && typeof value !== "number") throw new BadRequestException(`finance_invalid_${field}`);
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new BadRequestException(`finance_invalid_${field}`);
  return parsed;
}

function parseTransactionType(value: unknown): FinanceTransactionKind | undefined {
  if (value == null || value === "" || value === "all") return undefined;
  if (value === "sale" || value === "refund") return value;
  throw new BadRequestException("finance_invalid_type");
}

function parseOptionalText(value: unknown, field: string, maxLength: number): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string") throw new BadRequestException(`finance_invalid_${field}`);
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  if (normalized.length > maxLength) throw new BadRequestException(`finance_invalid_${field}`);
  return normalized;
}

function startOfSaoPauloDay(value: string): Date {
  // Brazil currently has no daylight-saving transition. A merchant time-zone
  // setting will replace this fixed business time zone when multi-country
  // settlement is introduced.
  return new Date(`${value}T00:00:00.000-03:00`);
}

function formatSaoPauloDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: FINANCE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function addCalendarDays(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return date.toISOString().slice(0, 10);
}

function subtractCalendarDays(value: string, days: number): string {
  return addCalendarDays(value, -days);
}

function decimalToBrl(value: { toNumber(): number } | number): number {
  return preciseBrl(typeof value === "number" ? value : value.toNumber());
}

function preciseBrl(value: number): number {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000;
}

function sumBrl(values: number[]): number {
  return preciseBrl(values.reduce((sum, value) => sum + value, 0));
}

function paymentRank(status: string): number {
  return CONFIRMED_PAYMENT_STATUSES.has(status.toLowerCase()) ? 2 : 1;
}

function canonicalPaymentMethod(method: string | null | undefined): string {
  const normalized = method?.trim().toLowerCase() ?? "";
  if (["credit_card", "card", "cartao", "cartão"].includes(normalized)) return "card";
  if (["boleto", "bank_slip"].includes(normalized)) return "boleto";
  return normalized;
}

function normalizePaymentMethod(method: string | null): string {
  const canonical = canonicalPaymentMethod(method);
  if (!canonical) return "Não informado";
  if (canonical === "pix") return "PIX";
  if (canonical === "card") return "Cartão";
  if (canonical === "boleto") return "Boleto";
  return method!;
}

function formatCsvBrl(value: number): string {
  return value.toFixed(2).replace(".", ",");
}

function escapeCsvCell(value: unknown, protectFormula = true): string {
  let text = String(value ?? "");
  if (protectFormula && /^[=+\-@]/.test(text)) text = `'${text}`;
  return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
