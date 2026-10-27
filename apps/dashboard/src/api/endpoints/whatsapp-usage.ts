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
