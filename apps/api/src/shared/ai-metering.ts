import { AsyncLocalStorage } from "node:async_hooks";

export type AiMeteringContext = {
  merchantId: string; source: string; conversationId?: string; voiceSessionId?: string;
  costCenter?: "text" | "voice" | "automation"; payer?: "platform" | "merchant";
};
export type AiMeteringSink = {
  fetch(context: AiMeteringContext, input: string | URL | Request, init?: RequestInit, transport?: typeof fetch): Promise<Response>;
};
const contexts = new AsyncLocalStorage<AiMeteringContext>();
let sink: AiMeteringSink | undefined;
let resolveTenant: (() => string | undefined) | undefined;

export function configureAiMetering(value: AiMeteringSink, tenant: () => string | undefined) {
  sink = value; resolveTenant = tenant;
  return () => { if (sink === value) { sink = undefined; resolveTenant = undefined; } };
}
export function withAiMetering<T>(context: AiMeteringContext, run: () => T): T {
  const parent = contexts.getStore();
  if (parent && parent.merchantId !== context.merchantId) return contexts.run(context, run);
  return contexts.run({ ...parent, ...context, costCenter: parent?.costCenter === "voice" ? "voice" : context.costCenter ?? parent?.costCenter }, run);
}
/** Only AI call sites use this transport. It never patches global fetch. */
export function meteredAiFetch(source: string, transport: typeof fetch = globalThis.fetch, explicit?: Partial<AiMeteringContext>): typeof fetch {
  return ((input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (!/\/(chat\/completions|responses|embeddings)\/?(?:\?|$)/.test(url)) return transport(input, init);
    if (!sink) {
      if (process.env.NODE_ENV === "production") throw new Error("ai_metering_not_initialized");
      return transport(input, init);
    }
    const parent = contexts.getStore();
    const merchantId = explicit?.merchantId ?? parent?.merchantId ?? resolveTenant?.();
    if (!merchantId) throw new Error("ai_metering_company_required");
    const purpose = parent?.source === "storefront_nudge" || parent?.source === "checkout_strategy" ? parent.source : source;
    return sink.fetch({ ...parent, ...explicit, merchantId, source: purpose }, input, init, transport);
  }) as typeof fetch;
}
