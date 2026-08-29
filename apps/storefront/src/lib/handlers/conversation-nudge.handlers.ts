import { Message } from "@/lib/viewmodels/useConversationViewModel";
import { checkoutApi } from "@/lib/api/api-client";
import { TRIGGER_MESSAGES } from "@/lib/trigger-messages";

export interface FireNudgeParams {
  triggerEvent: "idle_30_seconds" | "exit_intent_detected";
  merchantId: string | null;
  conversationId: string | null;
  agentMode: "silent_until_trigger" | "proactive" | "manual_only" | undefined;
  widgetConfig: any;
  experiment: any;
  cartId: string | null | undefined;
  setMode: (mode: "intro" | "chat") => void;
  setMessages: (updater: (prev: Message[]) => Message[]) => void;
  setIsLoading: (value: boolean) => void;
  canFireTrigger: (mid: string, event: string, cooldown: number) => boolean;
  recordTriggerFired: (mid: string, event: string) => void;
  getTrackingVariantId: () => string | null;
}

export function handleFireNudge(params: FireNudgeParams) {
  const {
    triggerEvent,
    merchantId,
    conversationId,
    agentMode,
    widgetConfig,
    experiment,
    cartId,
    setMode,
    setMessages,
    setIsLoading,
    canFireTrigger,
    recordTriggerFired,
    getTrackingVariantId,
  } = params;

  const mid = merchantId || "";
  if (agentMode === "manual_only") return;

  const cooldownMs = (widgetConfig?.cooldownSeconds ?? 120) * 1000;
  if (!canFireTrigger(mid, triggerEvent, cooldownMs)) return;
  const customTrigger = widgetConfig?.triggerMessages?.[triggerEvent];
  const staticNudge = customTrigger?.message || TRIGGER_MESSAGES[triggerEvent];
  if (!staticNudge) return;

  recordTriggerFired(mid, triggerEvent);
  const couponSuffix = customTrigger?.couponCode ? ` 🎁 Use o cupom **${customTrigger.couponCode}** para um desconto especial!` : "";
  const variantId = experiment?.variantId ?? getTrackingVariantId();
  const convId = conversationId;

  if (!variantId || !convId || !mid) {
    setMode("chat");
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "agent", text: staticNudge + couponSuffix }]);
    return;
  }

  setMode("chat");
  setIsLoading(true);

  let settled = false;
  const reveal = (text: string) => {
    if (settled) return;
    settled = true;
    setIsLoading(false);
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "agent", text }]);
  };
  const fallbackTimer = setTimeout(() => reveal(staticNudge + couponSuffix), 6000);
  const situation =
    triggerEvent === "exit_intent_detected"
      ? "O comprador está prestes a SAIR da loja (exit-intent)."
      : "O comprador está INATIVO/parado na loja há um tempo, sem interagir.";
  const styleDirective = experiment?.systemPrompt ? `Siga EXATAMENTE este estilo de comunicação: "${experiment.systemPrompt}".` : "Use um tom persuasivo, caloroso e vendedor.";
  const intent = [
    `[INSTRUÇÃO INTERNA — NÃO responda como se eu fosse o comprador.]`,
    situation,
    styleDirective,
    `Escreva UMA única frase curta (máx. 2 linhas), na primeira pessoa da vendedora, chamando o comprador de volta e oferecendo ajuda concreta para fechar a compra.`,
    `Não faça perguntas genéricas do tipo "como posso ajudar". Seja específica e no estilo acima. Responda SÓ com a mensagem, sem aspas.`,
  ].join(" ");
  void checkoutApi
    .sendMessage(convId, intent, { merchantId: mid, cartId: cartId || undefined, history: [], variantId })
    .then((data: any) => {
      clearTimeout(fallbackTimer);
      const styled = typeof data?.message === "string" ? data.message.trim().replace(/^["']|["']$/g, "") : "";
      const bad = !styled || /tive um problema|não consegui|erro ao|tente novamente/i.test(styled);
      reveal((bad ? staticNudge : styled) + couponSuffix);
    })
    .catch(() => {
      clearTimeout(fallbackTimer);
      reveal(staticNudge + couponSuffix);
    });
}
