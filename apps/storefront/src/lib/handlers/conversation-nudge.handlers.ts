import type { Message } from "@/lib/viewmodels/useConversationViewModel/types";
import { getTriggerMessage, TRIGGER_MESSAGES } from "@/lib/trigger-messages";
import { checkoutApi } from "@/lib/api/api-client";

export interface FireNudgeParams {
  triggerEvent: "idle_30_seconds" | "exit_intent_detected";
  stage?: "cart" | "browsing";
  merchantId: string | null;
  agentMode: "silent_until_trigger" | "proactive" | "manual_only" | undefined;
  widgetConfig: any;
  setMode: (mode: "intro" | "chat") => void;
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  setIsLoading: (value: boolean) => void;
  canFireTrigger: (mid: string, event: string, cooldown: number) => boolean;
  recordTriggerFired: (mid: string, event: string) => void;
}

function buildConversionNudge(stage: "cart" | "browsing" | undefined, widgetConfig: any, triggerEvent: string): string | null {
  if (stage !== "cart") return null;
  const couponCode: string | undefined = widgetConfig?.triggerMessages?.[triggerEvent]?.couponCode;
  if (couponCode) {
    return `Seu pedido está quase fechando! 🎁 Use o cupom **${couponCode}** e finalize agora com desconto.`;
  }
  const progressive = widgetConfig?.progressiveDiscount;
  if (progressive?.enabled && progressive.stages) {
    const percent = Math.max(0, ...Object.values(progressive.stages as Record<string, number>).map((n) => Number(n) || 0));
    if (percent > 0) {
      return `Garanta **${percent}% de desconto** finalizando seu pedido agora. É rápido!`;
    }
  }
  return "Seu pedido está quase lá — finalize agora e aproveite as condições especiais. 🛒";
}

function resolveFallback(stage: "cart" | "browsing" | undefined, widgetConfig: any, triggerEvent: string): string | undefined {
  const conversionText = buildConversionNudge(stage, widgetConfig, triggerEvent);
  if (conversionText) return conversionText;
  const customTrigger = widgetConfig?.triggerMessages?.[triggerEvent];
  const couponSuffix = customTrigger?.couponCode ? ` 🎁 Use o cupom **${customTrigger.couponCode}** para um desconto especial!` : "";
  const base = customTrigger?.message || getTriggerMessage(triggerEvent) || TRIGGER_MESSAGES[triggerEvent];
  return base ? base + couponSuffix : undefined;
}

export function handleFireNudge(params: FireNudgeParams) {
  const { triggerEvent, stage, merchantId, agentMode, widgetConfig, setMode, setMessages, setIsLoading, canFireTrigger, recordTriggerFired } = params;

  const mid = merchantId || "";
  if (agentMode === "manual_only") return;

  const cooldownMs = (widgetConfig?.cooldownSeconds ?? 120) * 1000;
  if (!canFireTrigger(mid, triggerEvent, cooldownMs)) return;

  const fallback = resolveFallback(stage, widgetConfig, triggerEvent);
  if (!fallback) return;

  recordTriggerFired(mid, triggerEvent);
  setMode("chat");

  if (!mid) {
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "agent", text: fallback, ephemeral: true }]);
    return;
  }

  setIsLoading(true);
  let settled = false;
  const reveal = (text: string) => {
    if (settled) return;
    settled = true;
    setIsLoading(false);
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "agent", text, ephemeral: true }]);
  };
  const fallbackTimer = setTimeout(() => reveal(fallback), 6000);

  checkoutApi
    .generateNudge(mid, triggerEvent, stage ?? "browsing", fallback)
    .then((res) => {
      clearTimeout(fallbackTimer);
      reveal(res?.message?.trim() || fallback);
    })
    .catch(() => {
      clearTimeout(fallbackTimer);
      reveal(fallback);
    });
}
