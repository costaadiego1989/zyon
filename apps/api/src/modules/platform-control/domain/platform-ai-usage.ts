export const PLATFORM_CHAT_USAGE_CAPTURE_SOURCE = "storefront_langgraph";
export const PLATFORM_CHAT_USAGE_CHANNEL = "chat";
export const PLATFORM_CHAT_USAGE_COMPONENT = "text_generation";
export const PLATFORM_VOICE_USAGE_CAPTURE_SOURCE = "openai_realtime_client_forwarded";
export const PLATFORM_VOICE_USAGE_CHANNEL = "voice";
export const PLATFORM_VOICE_USAGE_PROVIDER = "openai";

export type PlatformAiUsageMerchant = {
  merchantId: string;
  merchantName?: string;
  chat: PlatformAiUsageChannelTotals;
  voice: PlatformAiUsageVoiceTotals;
  estimatedEventCount: bigint;
  providerReportedEventCount: bigint;
  reconciledEventCount: bigint;
  unpricedEventCount: bigint;
  unpricedTokens: bigint;
  otherCostStatusEventCount: bigint;
  estimatedCosts: Array<{
    currency: string;
    costMicros: bigint;
    eventCount: bigint;
  }>;
  providerReportedCosts: Array<{
    currency: string;
    costMicros: bigint;
    eventCount: bigint;
  }>;
  reconciledCosts: Array<{
    currency: string;
    costMicros: bigint;
    eventCount: bigint;
  }>;
};

type PlatformAiUsageChannelTotals = {
  eventCount: bigint;
  promptTokens: bigint;
  completionTokens: bigint;
  totalTokens: bigint;
};

type PlatformAiUsageVoiceTotals = PlatformAiUsageChannelTotals & {
  responseCount: bigint;
  sessionCount: bigint;
  failedResponseCount: bigint;
};

export type PlatformAiUsageMerchantView = {
  merchant_id: string;
  merchant_name?: string;
  chat: {
    event_count: string;
    prompt_tokens: string;
    completion_tokens: string;
    total_tokens: string;
  };
  voice: {
    component_event_count: string;
    response_count: string;
    session_count: string;
    failed_response_count: string;
    prompt_tokens: string;
    completion_tokens: string;
    total_tokens: string;
  };
  costs: {
    estimated: {
      event_count: string;
      by_currency: Array<{
        currency: string;
        cost_micros: string;
        event_count: string;
      }>;
      caveat: "estimated_price_version_not_provider_invoice";
    };
    provider_reported: {
      event_count: string;
      by_currency: Array<{
        currency: string;
        cost_micros: string;
        event_count: string;
      }>;
      caveat: "provider_reported_event_cost_not_reconciled_invoice";
    };
    reconciled: {
      event_count: string;
      by_currency: Array<{
        currency: string;
        cost_micros: string;
        event_count: string;
      }>;
      caveat: "provider_reconciliation_reference_recorded";
    };
    unpriced: {
      event_count: string;
      total_tokens: string;
      caveat: "no_effective_price_version";
    };
    other_cost_status_event_count: string;
  };
};

export function presentPlatformAiUsageMerchant(item: PlatformAiUsageMerchant): PlatformAiUsageMerchantView {
  return {
    merchant_id: item.merchantId,
    ...(item.merchantName ? { merchant_name: item.merchantName } : {}),
    chat: presentChannel(item.chat),
    voice: {
      component_event_count: item.voice.eventCount.toString(),
      response_count: item.voice.responseCount.toString(),
      session_count: item.voice.sessionCount.toString(),
      failed_response_count: item.voice.failedResponseCount.toString(),
      prompt_tokens: item.voice.promptTokens.toString(),
      completion_tokens: item.voice.completionTokens.toString(),
      total_tokens: item.voice.totalTokens.toString(),
    },
    costs: {
      estimated: {
        event_count: item.estimatedEventCount.toString(),
        by_currency: presentCosts(item.estimatedCosts),
        caveat: "estimated_price_version_not_provider_invoice",
      },
      provider_reported: {
        event_count: item.providerReportedEventCount.toString(),
        by_currency: presentCosts(item.providerReportedCosts),
        caveat: "provider_reported_event_cost_not_reconciled_invoice",
      },
      reconciled: {
        event_count: item.reconciledEventCount.toString(),
        by_currency: presentCosts(item.reconciledCosts),
        caveat: "provider_reconciliation_reference_recorded",
      },
      unpriced: {
        event_count: item.unpricedEventCount.toString(),
        total_tokens: item.unpricedTokens.toString(),
        caveat: "no_effective_price_version",
      },
      other_cost_status_event_count: item.otherCostStatusEventCount.toString(),
    },
  };
}

function presentChannel(channel: PlatformAiUsageChannelTotals) {
  return {
    event_count: channel.eventCount.toString(),
    prompt_tokens: channel.promptTokens.toString(),
    completion_tokens: channel.completionTokens.toString(),
    total_tokens: channel.totalTokens.toString(),
  };
}

function presentCosts(costs: PlatformAiUsageMerchant["estimatedCosts"]) {
  return costs.map(cost => ({
    currency: cost.currency,
    cost_micros: cost.costMicros.toString(),
    event_count: cost.eventCount.toString(),
  }));
}
