import { Inject, Injectable } from "@nestjs/common";
import {
  PLATFORM_COMMERCE_REPOSITORY,
  type PlatformCommerceAudit,
  type PlatformCommerceRepository,
  type PlatformOrderQuery,
} from "../domain/ports/platform-commerce.repository.port.js";

export type PlatformOrderListInput = { from?: string; to?: string; status?: string; merchant_id?: string; query?: string; cursor?: string; limit?: string };
export type PlatformMerchantDetailInput = { from?: string; to?: string };
type AuditContext = Omit<PlatformCommerceAudit, "action" | "targetId" | "details">;

@Injectable()
export class ReadPlatformCommerceUseCases {
  constructor(@Inject(PLATFORM_COMMERCE_REPOSITORY) private readonly repository: PlatformCommerceRepository) {}

  async listOrders(input: PlatformOrderListInput, audit: AuditContext) {
    const query = normalizeOrderQuery(input);
    const page = await this.repository.listOrders(query);
    await this.repository.recordRead({ ...audit, action: "list", details: { itemCount: page.items.length, hasSearch: Boolean(query.query), hasStatus: Boolean(query.status), hasMerchant: Boolean(query.merchantId), hasPeriod: Boolean(query.from || query.to), limit: query.limit } });
    return page;
  }

  async orderDetail(id: string, audit: AuditContext) {
    const orderId = requiredId(id, "platform_orders_invalid_id");
    const detail = await this.repository.findOrder(orderId);
    await this.repository.recordRead({ ...audit, action: "detail", targetId: orderId, details: { found: Boolean(detail), includesCustomer: Boolean(detail?.customer), includesShippingAddress: Boolean(detail?.shipping.address) } });
    return detail;
  }

  async merchantRanking(input: { from?: string; to?: string; sort?: string; limit?: string }, audit: AuditContext) {
    const period = normalizeMerchantPeriod(input);
    const sort = input.sort === "ai_cost" || input.sort === "tokens" ? input.sort : "sales";
    if (input.sort !== undefined && input.sort !== "sales" && input.sort !== "ai_cost" && input.sort !== "tokens") throw new Error("platform_merchants_invalid_ranking_sort");
    const limit = input.limit === undefined ? 10 : pageSize(input.limit);
    const items = await this.repository.merchantRanking({ ...period, sort, limit });
    await this.repository.recordRead({ ...audit, action: "merchant_ranking", details: { itemCount: items.length, sort, limit, from: period.from.toISOString(), to: period.to.toISOString(), endExclusive: true } });
    return { period, sort, items };
  }
  async merchantDetail(id: string, input: PlatformMerchantDetailInput, audit: AuditContext) {
    const merchantId = requiredId(id, "platform_merchants_invalid_id");
    const period = normalizeMerchantPeriod(input);
    const detail = await this.repository.merchantDetail(merchantId, period);
    await this.repository.recordRead({ ...audit, action: "merchant_detail", targetId: merchantId, details: { found: Boolean(detail), from: period.from.toISOString(), to: period.to.toISOString(), endExclusive: true } });
    return detail;
  }
}

function normalizeOrderQuery(input: PlatformOrderListInput): PlatformOrderQuery {
  const from = optionalDate(input.from, "platform_orders_invalid_from");
  const to = optionalDate(input.to, "platform_orders_invalid_to");
  validatePeriod(from, to, "platform_orders_invalid_period");
  return { from, to, status: optionalText(input.status, "platform_orders_invalid_status", 48), merchantId: optionalText(input.merchant_id, "platform_orders_invalid_merchant_id", 160), query: optionalText(input.query, "platform_orders_invalid_query", 120), cursor: optionalText(input.cursor, "platform_orders_invalid_cursor", 160), limit: pageSize(input.limit) };
}

function normalizeMerchantPeriod(input: PlatformMerchantDetailInput): { from: Date; to: Date } {
  const to = optionalDate(input.to, "platform_merchants_invalid_to") ?? new Date();
  const from = optionalDate(input.from, "platform_merchants_invalid_from") ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  validatePeriod(from, to, "platform_merchants_invalid_period");
  return { from, to };
}

function optionalDate(value: string | undefined, code: string): Date | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string") throw new Error(code);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(code);
  return date;
}
function validatePeriod(from: Date | undefined, to: Date | undefined, code: string) {
  if (from && to && from >= to) throw new Error(code);
  if (from && to && to.getTime() - from.getTime() > 366 * 24 * 60 * 60 * 1000) throw new Error(code);
}
function pageSize(value: string | undefined): number {
  if (value === undefined) return 50;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) throw new Error("platform_orders_invalid_limit");
  return parsed;
}
function optionalText(value: string | undefined, code: string, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(code);
  const normalized = value.trim();
  if (!normalized) return undefined;
  if (normalized.length > max) throw new Error(code);
  return normalized;
}
function requiredId(value: string, code: string): string { return optionalText(value, code, 160) ?? (() => { throw new Error(code); })(); }
