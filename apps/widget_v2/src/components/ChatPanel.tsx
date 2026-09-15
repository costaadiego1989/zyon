import { PerimeterBorder } from "./PerimeterBorder";
import { useState, useRef, useEffect } from "react";
import { useCheckoutStore } from "@/store/checkout-store";
import { AgentAvatar } from "./AgentAvatar";
import { useRealtimeVoiceCheckout } from "@/lib/voice/use-realtime-voice-checkout";
import { renderInlineMarkdown, messageToSpeech } from "./chat/helpers";
import { BlockRenderer } from "./chat/ChatBlocks";
import { VoiceComposer } from "./chat/VoiceComposer";

export function ChatPanel() {
  const messages = useCheckoutStore((s) => s.messages);
  const isTyping = useCheckoutStore((s) => s.isTyping);
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    void sendMessage(input.trim());
    setInput("");
  };

  const handleQuickReply = (text: string) => {
    void sendMessage(text);
  };

  const lastAgentMsg = [...messages].reverse().find((m) => m.role === "agent");
  const activeQuickReplies = lastAgentMsg?.quickReplies ?? [];

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

            <div style={{ maxWidth: "80%", display: "flex", flexDirection: "column", gap: "6px", minWidth: 0 }}>
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
                  {msg.role === "agent" ? renderInlineMarkdown(msg.text) : msg.text}
                </div>
              )}
              {msg.blocks?.map((block, j) => (
                <div data-neu="surface" key={j} style={{ padding: "10px 12px", borderRadius: "12px", background: "var(--card)", border: "1px solid var(--bd)" }}>
                  <BlockRenderer block={block} />
                </div>
              ))}
            </div>
          </div>
        ))}

        {activeQuickReplies.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", paddingLeft: "36px" }}>
            {activeQuickReplies.map((qr) => (
              <button data-neu="control"
                key={qr}
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
      `}</style>
    </div>
  );
}
