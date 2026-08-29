import type { Message } from "@/lib/viewmodels/useConversationViewModel/types";
import { getTriggerMessage, TRIGGER_MESSAGES } from "@/lib/trigger-messages";

export interface FireNudgeParams {
  triggerEvent: "idle_30_seconds" | "exit_intent_detected";
  merchantId: string | null;
  agentMode: "silent_until_trigger" | "proactive" | "manual_only" | undefined;
  widgetConfig: any;
  setMode: (mode: "intro" | "chat") => void;
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  canFireTrigger: (mid: string, event: string, cooldown: number) => boolean;
  recordTriggerFired: (mid: string, event: string) => void;
}

export function handleFireNudge(params: FireNudgeParams) {
  const { triggerEvent, merchantId, agentMode, widgetConfig, setMode, setMessages, canFireTrigger, recordTriggerFired } = params;

  const mid = merchantId || "";
  if (agentMode === "manual_only") return;

  const cooldownMs = (widgetConfig?.cooldownSeconds ?? 120) * 1000;
  if (!canFireTrigger(mid, triggerEvent, cooldownMs)) return;

  const customTrigger = widgetConfig?.triggerMessages?.[triggerEvent];
  const couponSuffix = customTrigger?.couponCode ? ` 🎁 Use o cupom **${customTrigger.couponCode}** para um desconto especial!` : "";
  const text = customTrigger?.message || getTriggerMessage(triggerEvent) || TRIGGER_MESSAGES[triggerEvent];
  if (!text) return;

  recordTriggerFired(mid, triggerEvent);
  setMode("chat");
  setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "agent", text: text + couponSuffix, ephemeral: true }]);
}
