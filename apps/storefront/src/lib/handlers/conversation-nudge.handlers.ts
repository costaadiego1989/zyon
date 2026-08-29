import type { Message } from "@/lib/viewmodels/useConversationViewModel/types";
import { getTriggerMessage, TRIGGER_MESSAGES } from "@/lib/trigger-messages";

export interface FireNudgeParams {
  triggerEvent: "idle_30_seconds" | "exit_intent_detected";
  /** "cart" when the buyer already has items (conversion focus); "browsing" otherwise. */
  stage?: "cart" | "browsing";
  merchantId: string | null;
  agentMode: "silent_until_trigger" | "proactive" | "manual_only" | undefined;
  widgetConfig: any;
  setMode: (mode: "intro" | "chat") => void;
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  canFireTrigger: (mid: string, event: string, cooldown: number) => boolean;
  recordTriggerFired: (mid: string, event: string) => void;
}

/**
 * Builds a conversion-focused nudge for a buyer who already has a cart. The
 * checkout is conversion-oriented, so this never asks an open question (that
 * would require interaction tools) — it always makes an OFFER, citing whatever
 * incentive is active, in priority order: trigger coupon → progressive discount
 * → generic closing line. Returns null when stage isn't "cart".
 */
function buildConversionNudge(
  stage: "cart" | "browsing" | undefined,
  widgetConfig: any,
  triggerEvent: string,
): string | null {
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

  // No specific incentive to cite — still a closing offer, never a question.
  return "Seu pedido está quase lá — finalize agora e aproveite as condições especiais. 🛒";
}

export function handleFireNudge(params: FireNudgeParams) {
  const { triggerEvent, stage, merchantId, agentMode, widgetConfig, setMode, setMessages, canFireTrigger, recordTriggerFired } = params;

  const mid = merchantId || "";
  if (agentMode === "manual_only") return;

  const cooldownMs = (widgetConfig?.cooldownSeconds ?? 120) * 1000;
  if (!canFireTrigger(mid, triggerEvent, cooldownMs)) return;

  // Cart stage → conversion offer (coupon/progressive/closing). Browsing stage →
  // the configured discovery message.
  const conversionText = buildConversionNudge(stage, widgetConfig, triggerEvent);
  let text: string | undefined;
  if (conversionText) {
    text = conversionText;
  } else {
    const customTrigger = widgetConfig?.triggerMessages?.[triggerEvent];
    const couponSuffix = customTrigger?.couponCode ? ` 🎁 Use o cupom **${customTrigger.couponCode}** para um desconto especial!` : "";
    const base = customTrigger?.message || getTriggerMessage(triggerEvent) || TRIGGER_MESSAGES[triggerEvent];
    text = base ? base + couponSuffix : undefined;
  }
  if (!text) return;

  recordTriggerFired(mid, triggerEvent);
  setMode("chat");
  setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "agent", text: text!, ephemeral: true }]);
}
