import { Inject, Injectable } from "@nestjs/common";
import { Prisma, type PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { businessDateKey, businessDayStart, resolveBusinessPeriod, DASHBOARD_TIME_ZONE } from "../../../../shared/analytics/business-period.js";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../domain/ports/whatsapp-config-repository.port.js";

export type WhatsAppUsagePeriod = "month" | "7d" | "30d";
export interface WhatsAppUsage {
  period: { key: WhatsAppUsagePeriod; from: string; to: string; timeZone: string };
  fetchedAt: string;
  connection: "connected" | "unavailable";
  currency: string | null;
  messages: { available: boolean; sent: number | null; delivered: number | null };
  pricing: { available: boolean; cost: number | null; volume: number | null; categories: Array<{ category: string; pricingType: string; volume: number; cost: number }> };
  processing: { received: number; processed: number; pending: number; failed: number; recentPending: number; recentFailed: number; oldestPendingAt: string | null };
  billingUrl: string;
  managerUrl: string;
  notices: string[];
}

const phone = (value: unknown) => typeof value === "string" ? value.replace(/\D/g, "") : "";
const amount = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

@Injectable()
export class GetWhatsAppUsageUseCase {
  private readonly cache = new Map<string, { expires: number; value: WhatsAppUsage }>();
  private readonly inflight = new Map<string, Promise<WhatsAppUsage>>();
  constructor(
    @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configs: WhatsAppConfigRepository,
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
  ) {}

  async execute(merchantId: string, period: WhatsAppUsagePeriod = "month"): Promise<WhatsAppUsage> {
    const config = await this.configs.findByMerchantId(merchantId);
    // A cache entry can never cross tenants or survive a credential/number change.
    const key = JSON.stringify([merchantId, period, config?.id, config?.updatedAt, config?.whatsappNumber]);
    const cached = this.cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const existing = this.inflight.get(key);
    if (existing) return existing;
    const task = this.load(merchantId, period, config).then(value => {
      if (this.cache.size >= 500) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(key, { expires: Date.now() + 60_000, value });
      return value;
    }).finally(() => { this.inflight.delete(key); });
    this.inflight.set(key, task);
    return task;
  }

  private async load(merchantId: string, period: WhatsAppUsagePeriod, config: Awaited<ReturnType<WhatsAppConfigRepository["findByMerchantId"]>>): Promise<WhatsAppUsage> {
    const now = new Date();
    const from = period === "month" ? businessDayStart(businessDateKey(now).slice(0, 8) + "01") : resolveBusinessPeriod(period, now).from;
    const rows = await this.prisma.$queryRaw<Array<{ received: bigint; processed: bigint; pending: bigint; failed: bigint; recent_pending: bigint; recent_failed: bigint; oldest_pending_at: Date | null }>>(Prisma.sql`
      SELECT COUNT(*) AS received,
        COUNT(*) FILTER (WHERE status = 'processed') AS processed,
        COUNT(*) FILTER (WHERE status IN ('pending', 'processing')) AS pending,
        COUNT(*) FILTER (WHERE status = 'dead') AS failed,
        COUNT(*) FILTER (WHERE status IN ('pending', 'processing') AND created_at >= ${new Date(now.getTime() - 86_400_000)}) AS recent_pending,
        COUNT(*) FILTER (WHERE status = 'dead' AND created_at >= ${new Date(now.getTime() - 86_400_000)}) AS recent_failed,
        MIN(created_at) FILTER (WHERE status IN ('pending', 'processing')) AS oldest_pending_at
      FROM whatsapp_webhook_inbox WHERE merchant_id = ${merchantId} AND kind = 'message'
        AND created_at >= ${from} AND created_at <= ${now}
    `);
    const counts = rows[0];
    const credentials = config?.credentials ?? {};
    const wabaId = typeof credentials.wabaId === "string" && /^\d{5,40}$/.test(credentials.wabaId) ? credentials.wabaId : null;
    const accessToken = typeof credentials.accessToken === "string" ? credentials.accessToken : null;
    const number = phone(config?.whatsappNumber);
    const result: WhatsAppUsage = {
      period: { key: period, from: from.toISOString(), to: now.toISOString(), timeZone: DASHBOARD_TIME_ZONE }, fetchedAt: now.toISOString(),
      connection: "unavailable", currency: null,
      messages: { available: false, sent: null, delivered: null },
      pricing: { available: false, cost: null, volume: null, categories: [] },
      processing: { received: Number(counts?.received ?? 0), processed: Number(counts?.processed ?? 0), pending: Number(counts?.pending ?? 0), failed: Number(counts?.failed ?? 0),
        recentPending: Number(counts?.recent_pending ?? 0), recentFailed: Number(counts?.recent_failed ?? 0), oldestPendingAt: counts?.oldest_pending_at?.toISOString() ?? null },
      billingUrl: "https://business.facebook.com/billing_hub/",
      managerUrl: "https://business.facebook.com/wa/manage/home/" + (wabaId ? `?waba_id=${wabaId}` : ""), notices: [],
    };
    if (!config || config.merchantId !== merchantId || config.provider !== "META_CLOUD" || !wabaId || !accessToken || !/^\d{8,15}$/.test(number)) {
      result.notices.push("meta_connection_unavailable"); return result;
    }
    result.connection = "connected";
    const start = Math.floor(from.getTime() / 1000), end = Math.floor(now.getTime() / 1000);
    const filter = `.phone_numbers(${JSON.stringify([number])})`;
    const [account, messages, pricing] = await Promise.all([
      this.graph(wabaId, accessToken, "currency"),
      this.graph(wabaId, accessToken, `analytics.start(${start}).end(${end}).granularity(DAY)${filter}`),
      this.graph(wabaId, accessToken, `pricing_analytics.start(${start}).end(${end}).granularity(DAILY)${filter}.dimensions(PRICING_CATEGORY,PRICING_TYPE,PHONE)`),
    ]);
    if (typeof account?.currency === "string" && /^[A-Z]{3}$/.test(account.currency)) result.currency = account.currency;
    else result.notices.push("meta_currency_unavailable");
    const analytics = messages?.analytics;
    if (analytics && Array.isArray(analytics.data_points) && Array.isArray(analytics.phone_numbers)
      && analytics.phone_numbers.every((value: unknown) => phone(value) === number)) {
      const points = analytics.data_points;
      if (points.every((point: any) => amount(point.sent) !== null && amount(point.delivered) !== null)) {
        result.messages = { available: true, sent: points.reduce((n: number, p: any) => n + p.sent, 0), delivered: points.reduce((n: number, p: any) => n + p.delivered, 0) };
      }
    }
    if (!result.messages.available) result.notices.push("meta_message_analytics_unavailable");
    const groups = pricing?.pricing_analytics?.data;
    if (Array.isArray(groups) && groups.every((group: any) => Array.isArray(group.data_points))) {
      const points = groups.flatMap((group: any) => group.data_points);
      if (points.every((point: any) => phone(point.phone_number) === number && amount(point.volume) !== null && amount(point.cost) !== null
        && typeof point.pricing_category === "string" && typeof point.pricing_type === "string")) {
        const categories = new Map<string, WhatsAppUsage["pricing"]["categories"][number]>();
        for (const point of points) {
          const key = JSON.stringify([point.pricing_category, point.pricing_type]);
          const category = categories.get(key) ?? { category: point.pricing_category, pricingType: point.pricing_type, cost: 0, volume: 0 };
          category.volume += point.volume; category.cost += point.cost; categories.set(key, category);
        }
        result.pricing = { available: true, cost: points.reduce((n: number, p: any) => n + p.cost, 0), volume: points.reduce((n: number, p: any) => n + p.volume, 0), categories: [...categories.values()] };
      }
    }
    if (!result.pricing.available) result.notices.push("meta_pricing_analytics_unavailable");
    return result;
  }

  private async graph(wabaId: string, accessToken: string, fields: string): Promise<any | null> {
    try {
      const response = await fetch(`https://graph.facebook.com/v23.0/${wabaId}?fields=${encodeURIComponent(fields)}`, {
        headers: { Authorization: `Bearer ${accessToken}` }, redirect: "error", signal: AbortSignal.timeout(12_000),
      });
      if (!response.ok) return null;
      const value = await response.json();
      return value && typeof value === "object" && !("error" in value) ? value : null;
    } catch { return null; }
  }
}
