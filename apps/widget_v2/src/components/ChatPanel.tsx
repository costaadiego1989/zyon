import { PerimeterBorder } from "./PerimeterBorder";
import { useState, useRef, useEffect } from "react";
import {
  isEnabledPaymentQuickReply,
  paymentMethodForQuickReply,
  useCheckoutStore,
} from "@/store/checkout-store";
import { AgentAvatar } from "./AgentAvatar";
import { useRealtimeVoiceCheckout } from "@/lib/voice/use-realtime-voice-checkout";
import { renderInlineMarkdown, messageToSpeech } from "./chat/helpers";
import { BlockRenderer } from "./chat/ChatBlocks";
import { VoiceComposer } from "./chat/VoiceComposer";

function isPaymentPresentationBlock(type: string): boolean {
  return ["pix_payment", "hosted_card_payment", "boleto_payment", "stripe_card"].includes(type);
}

export function ChatPanel() {
  const messages = useCheckoutStore((s) => s.messages);
  const isTyping = useCheckoutStore((s) => s.isTyping);
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  const pay = useCheckoutStore((s) => s.pay);
  const paymentCreating = useCheckoutStore((s) => s.paymentCreating);
  const cart = useCheckoutStore((s) => s.cart);
  const merchantPaymentConfig = useCheckoutStore((s) => s.merchantPaymentConfig);
  const continueVoiceCheckout = useCheckoutStore((s) => s.continueVoiceCheckout);
  const channel = useCheckoutStore((s) => s.channel);
  const [typingAlongsideVoice, setTypingAlongsideVoice] = useState(false);
  const api = useCheckoutStore((s) => s.api);
  const [input, setInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);
  const voiceAutoStartedRef = useRef(false);

  const voice = useRealtimeVoiceCheckout({
    enabled: channel === "voice",
    createSession: async () => {
      if (!api) throw new Error("checkout_session_missing");
      return api.createRealtimeVoiceSession();
    },
    onCommerceTurn: async (buyerMessage, action) => {
      await sendMessage(action === "add_item_to_cart" ? `Adicionar ao carrinho: ${buyerMessage}` : buyerMessage);
      const current = useCheckoutStore.getState();
      const agentReply = [...current.messages].reverse().find((message) => message.role === "agent");
      return {
        agentMessage: agentReply ? (messageToSpeech(agentReply) || "Atualizei sua compra. Posso continuar?") : "Atualizei sua compra. Posso continuar?",
        cart: { itemCount: current.cart.items.length, total: current.cart.total },
      };
    },
    onBeginCheckout: async () => {
      await continueVoiceCheckout();
      const current = useCheckoutStore.getState();
      const agentReply = [...current.messages].reverse().find((message) => message.role === "agent");
      return {
        agentMessage: agentReply ? (messageToSpeech(agentReply) || "Atualizei seu checkout. Posso continuar?") : "Atualizei seu checkout. Posso continuar?",
        cart: { itemCount: current.cart.items.length, total: current.cart.total },
      };
    },
  });

  // Selecting voice is itself a buyer action. Start it as the checkout opens
  // so a storefront hand-off does not require a second microphone click.
  useEffect(() => {
    if (channel !== "voice") {
      voiceAutoStartedRef.current = false;
      return;
    }
    if (voiceAutoStartedRef.current) return;
    voiceAutoStartedRef.current = true;
    voice.start();
  }, [channel, voice.start]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isTyping]);

  const lastAgentMsg = [...messages].reverse().find((m) => m.role === "agent");
  const isPaymentChoiceStage = Boolean(
    lastAgentMsg?.checkoutStage === "payment" ||
    lastAgentMsg?.blocks?.some((block) => block.type === "payment_methods") ||
    cart.status === "ready_to_pay",
  );

  const handlePaymentChoice = (text: string): boolean => {
    const method = paymentMethodForQuickReply(text);
    if (!method || !isPaymentChoiceStage || !isEnabledPaymentQuickReply(text, merchantPaymentConfig)) return false;
    void pay(method);
    return true;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    if (!handlePaymentChoice(input.trim())) void sendMessage(input.trim());
    setInput("");
  };

  const handleQuickReply = (text: string) => {
    if (!handlePaymentChoice(text)) void sendMessage(text);
  };

  const activeQuickReplies = (lastAgentMsg?.quickReplies ?? [])
    .filter((quickReply) => isEnabledPaymentQuickReply(quickReply, merchantPaymentConfig));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div
        style={{ flex: 1, minWidth: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: "12px", padding: "12px 0" }}
        role="log"
        aria-label="Mensagens do chat"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: "8px",
              width: "100%",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              animation: "bubble-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
            }}
          >
            {msg.role === "agent" && (
              <AgentAvatar active />
            )}

            <div style={{ maxWidth: msg.blocks?.some((block) => isPaymentPresentationBlock(block.type)) ? "min(100%, 620px)" : "80%", display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
              {msg.text && (
                <div data-neu="message" data-speaker={msg.role === "user" ? "buyer" : "agent"}
                  style={{
                    padding: "10px 14px",
                    borderRadius: "18px",
                    background: msg.role === "user" ? "var(--aacp-accent, #0f766e)" : "var(--card)",
                    color: msg.role === "user" ? "#fff" : "var(--tx)",
                    fontSize: "13px",
                    lineHeight: 1.5,
                    wordBreak: "break-word",
                    border: msg.role === "agent" ? "1px solid var(--bd)" : "none",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {msg.role === "agent" ? renderInlineMarkdown(msg.text.replace(/^(?:Zion|Zyon)\s*:\s*/i, "")) : msg.text}
                </div>
              )}
              {msg.blocks?.map((block, j) => {
                const paymentBlock = isPaymentPresentationBlock(block.type);
                return (
                  <div
                    data-neu={paymentBlock ? undefined : "surface"}
                    key={j}
                    className={paymentBlock ? "checkout-chat__payment-block" : undefined}
                    style={paymentBlock ? undefined : { padding: "10px 12px", borderRadius: "12px", background: "var(--card)", border: "1px solid var(--bd)" }}
                  >
                    <BlockRenderer block={block} />
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {activeQuickReplies.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", paddingLeft: "36px" }}>
            {activeQuickReplies.map((qr) => (
              <button data-neu="control"
                key={qr}
                disabled={paymentCreating}
                onClick={() => handleQuickReply(qr)}
                style={{
                  padding: "8px 14px",
                  borderRadius: "20px",
                  border: "1px solid var(--bd)",
                  background: "var(--chip)",
                  color: "var(--tx)",
                  fontSize: "12px",
                  fontWeight: 500,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  transition: "border-color 0.15s, background 0.15s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--aacp-accent, #0f766e)";
                  e.currentTarget.style.background = "color-mix(in srgb, var(--aacp-accent, #0f766e) 10%, transparent)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--bd)";
                  e.currentTarget.style.background = "var(--chip)";
                }}
              >
                {qr}
              </button>
            ))}
          </div>
        )}

        {isTyping && (
          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
            <AgentAvatar active />
            <div data-neu="message" style={{ padding: "10px 12px", borderRadius: "18px", background: "var(--card)", color: "var(--mut)", border: "1px solid var(--bd)" }}>
              <span style={{ animation: "dot-pulse 1.2s infinite" }}>●</span>
              <span style={{ animation: "dot-pulse 1.2s infinite", animationDelay: "0.2s" }}>●</span>
              <span style={{ animation: "dot-pulse 1.2s infinite", animationDelay: "0.4s" }}>●</span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {channel === "voice" ? (
        <>
          <VoiceComposer voice={voice} />
          <button data-neu="text" type="button" onClick={() => {
            if (!typingAlongsideVoice) voice.stop();
            setTypingAlongsideVoice((value) => !value);
          }}
            style={{ alignSelf: "center", padding: "8px 12px", background: "transparent", border: 0, color: "var(--tx)", cursor: "pointer", font: "inherit", fontSize: "12px" }}>
            {typingAlongsideVoice ? "Ocultar campo de mensagem" : "Digitar mensagem"}
          </button>
        </>
      ) : null}
      {(channel !== "voice" || typingAlongsideVoice) && (
        <div style={{ flexShrink: 0, padding: "10px 0 0", borderTop: "1px solid var(--bd)" }}>
          <form data-neu="inset" data-aacp-checkout-composer data-aacp-composer-frame
            onSubmit={handleSubmit}
            style={{ position: "relative", display: "flex", alignItems: "center", gap: "9px", padding: "9px 9px 9px 15px", background: "var(--aacp-inset-bg, var(--chip))", border: "1px solid var(--bd)", borderRadius: "14px", transition: "border-color 0.2s ease, box-shadow 0.2s ease" }}
          >
            <PerimeterBorder radius="14px" variant="input" />
            <input data-neu="field"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isTyping ? "Aguarde..." : "Escreva sua mensagem..."}
              disabled={isTyping}
              aria-label="Mensagem"
              style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--tx)", fontSize: "13px", padding: 0, fontFamily: "inherit" }}
            />
            <button data-neu="send"
              type="submit"
              disabled={!input.trim() || isTyping}
              aria-label="Enviar mensagem"
              style={{ width: "36px", height: "36px", borderRadius: "10px", background: input.trim() && !isTyping ? "var(--aacp-accent, #0f766e)" : "var(--bd)", color: "#fff", border: "none", cursor: input.trim() && !isTyping ? "pointer" : "not-allowed", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", padding: 0 }}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </form>
        </div>
      )}

      <style>{`
        @keyframes bubble-in { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes dot-pulse { 0%,80%,100% { opacity: .3; } 40% { opacity: 1; } }
        @keyframes bounce { from { transform: translateY(0); } to { transform: translateY(-8px); } }
        @keyframes checkout-payment-pulse { 0%, 100% { opacity: .45; transform: scale(.82); } 50% { opacity: 1; transform: scale(1); } }
        .checkout-chat__payment-block { width: 100%; }
        .checkout-payment-panel { box-sizing: border-box; width: 100%; padding: 18px; border: 1px solid var(--bd); border-radius: 18px; background: var(--card); color: var(--tx); }
        .checkout-payment-panel__header { display: flex; align-items: center; gap: 11px; }
        .checkout-payment-panel__mark { width: 36px; height: 36px; flex: none; display: grid; place-items: center; border: 1px solid color-mix(in srgb, var(--aacp-accent, #0f766e) 34%, var(--bd)); border-radius: 12px; color: var(--aacp-accent-text, var(--aacp-accent, #0f766e)); background: color-mix(in srgb, var(--aacp-accent, #0f766e) 8%, var(--chip)); }
        .checkout-payment-panel__eyebrow { margin: 0 0 2px; color: var(--mut); font-family: 'Space Mono', monospace; font-size: 9px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
        .checkout-payment-panel h3 { margin: 0; color: var(--tx); font-size: 15px; line-height: 1.25; letter-spacing: -.1px; }
        .checkout-payment-panel__description { max-width: 56ch; margin: 12px 0 0; color: var(--mut); font-size: 12px; line-height: 1.55; }
        .checkout-payment-panel__total { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-top: 15px; padding: 12px 0; border-top: 1px solid var(--bd); border-bottom: 1px solid var(--bd); }
        .checkout-payment-panel__total span { color: var(--mut); font-size: 12px; }
        .checkout-payment-panel__total strong { color: var(--tx); font-size: 18px; letter-spacing: -.45px; white-space: nowrap; }
        .checkout-payment-panel__body { display: grid; gap: 12px; margin-top: 14px; }
        .checkout-payment-panel__action { box-sizing: border-box; width: 100%; min-height: 44px; display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 11px 14px; border: 1px solid color-mix(in srgb, var(--aacp-accent, #0f766e) 46%, var(--bd)); border-radius: 13px; background: color-mix(in srgb, var(--aacp-accent, #0f766e) 13%, var(--chip)); color: var(--aacp-accent-text, var(--aacp-accent, #0f766e)); font: inherit; font-size: 13px; font-weight: 750; line-height: 1.2; text-align: center; text-decoration: none; cursor: pointer; transition: background 160ms ease, border-color 160ms ease, transform 160ms ease; }
        .checkout-payment-panel__action:hover:not(:disabled) { border-color: var(--aacp-accent, #0f766e); background: color-mix(in srgb, var(--aacp-accent, #0f766e) 19%, var(--chip)); transform: translateY(-1px); }
        .checkout-payment-panel__action:active:not(:disabled) { transform: translateY(0); }
        .checkout-payment-panel__action:disabled { cursor: not-allowed; opacity: .55; }
        .checkout-payment-panel__hint { margin: -2px 0 0; color: var(--mut); font-size: 10.5px; line-height: 1.4; text-align: center; }
        .checkout-payment-panel__status { display: flex; align-items: center; gap: 8px; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--bd); color: var(--mut); font-size: 11px; line-height: 1.35; }
        .checkout-payment-panel__status span { width: 7px; height: 7px; flex: none; border-radius: 50%; background: var(--aacp-accent, #0f766e); animation: checkout-payment-pulse 1.8s ease-in-out infinite; }
        .checkout-payment-panel__qr { display: flex; justify-content: center; padding: 4px 0; }
        .checkout-payment-panel__qr img { display: block; width: min(180px, 100%); aspect-ratio: 1; object-fit: contain; padding: 8px; border: 1px solid var(--bd); border-radius: 14px; background: var(--chip); }
        .checkout-payment-panel__code { display: flex; align-items: center; gap: 8px; }
        .checkout-payment-panel__code code { min-width: 0; flex: 1; overflow: hidden; padding: 11px 12px; border: 1px solid var(--bd); border-radius: 12px; background: var(--chip); color: var(--tx); font-family: 'Space Mono', monospace; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
        .checkout-payment-panel__code button { width: auto; min-height: 40px; flex: none; padding: 9px 12px; font-size: 11px; }
        .checkout-payment-panel__stripe-form { display: grid; gap: 12px; }
        .checkout-payment-panel__card-field { padding: 13px 12px; border: 1px solid var(--bd); border-radius: 12px; background: var(--chip); }
        .checkout-payment-panel__error { margin: 0; padding: 10px 12px; border: 1px solid color-mix(in srgb, #b84040 42%, var(--bd)); border-radius: 12px; background: color-mix(in srgb, #b84040 9%, var(--card)); color: var(--tx); font-size: 11.5px; line-height: 1.4; }
        .checkout-payment-panel--error { padding: 16px; }
        .checkout-payment-panel--error p { margin: 7px 0 0; color: var(--mut); font-size: 12px; line-height: 1.5; }
        .checkout-payment-panel--completed { display: flex; align-items: center; gap: 12px; padding: 18px; border-color: color-mix(in srgb, var(--aacp-accent, #0f766e) 45%, var(--bd)); }
        .checkout-payment-panel__success { width: 34px; height: 34px; flex: none; display: grid; place-items: center; border-radius: 50%; background: color-mix(in srgb, var(--aacp-accent, #0f766e) 15%, var(--chip)); color: var(--aacp-accent-text, var(--aacp-accent, #0f766e)); font-size: 18px; font-weight: 800; }
        .checkout-payment-panel--completed p { margin: 4px 0 0; color: var(--mut); font-size: 12px; line-height: 1.4; }
        @media (max-width: 480px) { .checkout-payment-panel { padding: 15px; border-radius: 16px; } .checkout-payment-panel__code { align-items: stretch; flex-direction: column; } .checkout-payment-panel__code button { width: 100%; } }
        @media (prefers-reduced-motion: reduce) { .checkout-payment-panel__status span { animation: none; } .checkout-payment-panel__action { transition: none; } }
      `}</style>
    </div>
  );
}
