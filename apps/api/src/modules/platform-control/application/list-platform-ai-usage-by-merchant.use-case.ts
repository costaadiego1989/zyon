import { Inject, Injectable } from "@nestjs/common";
import {
  presentPlatformAiUsageMerchant,
  PLATFORM_CHAT_USAGE_CAPTURE_SOURCE,
  PLATFORM_CHAT_USAGE_CHANNEL,
  PLATFORM_CHAT_USAGE_COMPONENT,
  PLATFORM_VOICE_USAGE_CAPTURE_SOURCE,
  PLATFORM_VOICE_USAGE_CHANNEL,
  PLATFORM_VOICE_USAGE_PROVIDER,
} from "../domain/platform-ai-usage.js";
import {
  PLATFORM_AI_USAGE_REPOSITORY,
  type PlatformAiUsageReadAudit,
  type PlatformAiUsageRepository,
} from "../domain/ports/platform-ai-usage-repository.port.js";

const DEFAULT_PERIOD_DAYS = 30;
const MAX_PERIOD_DAYS = 366;

@Injectable()
export class ListPlatformAiUsageByMerchantUseCase {
  constructor(
    @Inject(PLATFORM_AI_USAGE_REPOSITORY)
    private readonly usage: PlatformAiUsageRepository,
  ) {}

  async execute(
    input: { from?: string; to?: string; limit?: string },
    audit: Omit<PlatformAiUsageReadAudit, "from" | "to" | "limit" | "itemCount">,
  ) {
    const period = utcPeriod(input.from, input.to);
    const limit = pageSize(input.limit);
    const items = await this.usage.listByMerchant({ ...period, limit });
    await this.usage.recordRead({ ...audit, ...period, limit, itemCount: items.length });

    return {
      period: {
        from: period.from.toISOString(),
        to: period.to.toISOString(),
        timezone: "UTC" as const,
        end_exclusive: true,
      },
      coverage: {
        chat: {
          status: "available" as const,
          attribution: "server_captured" as const,
          source: PLATFORM_CHAT_USAGE_CAPTURE_SOURCE,
          channel: PLATFORM_CHAT_USAGE_CHANNEL,
          component: PLATFORM_CHAT_USAGE_COMPONENT,
          execution_status: "succeeded" as const,
        },
        voice: {
          status: "partial" as const,
          attribution: "client_forwarded_provider_event" as const,
          source: PLATFORM_VOICE_USAGE_CAPTURE_SOURCE,
          provider: PLATFORM_VOICE_USAGE_PROVIDER,
          channel: PLATFORM_VOICE_USAGE_CHANNEL,
          caveat: "browser_forwarded_usage_requires_provider_invoice_reconciliation" as const,
        },
        costs: {
          status: "partial" as const,
          estimated: "versioned_price_estimate_not_provider_invoice" as const,
          reconciled: "trusted_server_provider_invoice_or_export_value" as const,
          unpriced: "events_without_effective_price_version_are_counted_separately" as const,
        },
      },
      items: items.map(presentPlatformAiUsageMerchant),
    };
  }
}

function utcPeriod(fromValue: string | undefined, toValue: string | undefined): { from: Date; to: Date } {
  const to = toValue === undefined ? new Date() : utcInstant(toValue, "platform_ai_usage_invalid_to");
  const from = fromValue === undefined
    ? new Date(to.getTime() - DEFAULT_PERIOD_DAYS * 24 * 60 * 60 * 1000)
    : utcInstant(fromValue, "platform_ai_usage_invalid_from");
  if (from >= to || to.getTime() - from.getTime() > MAX_PERIOD_DAYS * 24 * 60 * 60 * 1000) {
    throw new Error("platform_ai_usage_invalid_period");
  }
  return { from, to };
}

function utcInstant(value: string, code: string): Date {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(normalized)) {
    throw new Error(code);
  }
  const date = new Date(normalized);
  const canonical = normalized.includes(".")
    ? normalized.replace(/\.(\d{1,3})Z$/, (_value, milliseconds: string) => `.${milliseconds.padEnd(3, "0")}Z`)
    : normalized.replace("Z", ".000Z");
  if (Number.isNaN(date.getTime()) || date.toISOString() !== canonical) throw new Error(code);
  return date;
}

function pageSize(value: string | undefined): number {
  if (value === undefined) return 50;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("platform_ai_usage_invalid_limit");
  }
  return parsed;
}
