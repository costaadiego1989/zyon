import { useState, useRef, useEffect, useCallback } from "react";
import { useCheckoutStore } from "@/store/checkout-store";
import { AgentAvatar } from "./AgentAvatar";
import { useVoiceCheckout } from "@/lib/voice/use-voice-checkout";
import { renderInlineMarkdown, messageToSpeech } from "./chat/helpers";
import { BlockRenderer } from "./chat/ChatBlocks";
import { VoiceComposer } from "./chat/VoiceComposer";
import { PerimeterBorder } from "./PerimeterBorder";

type ChatPanelProps = {
  onOpenCart?: () => void;
};

export function ChatPanel({ onOpenCart }: ChatPanelProps) {
  const messages = useCheckoutStore((s) => s.messages);
  const isTyping = useCheckoutStore((s) => s.isTyping);
  const sendMessage = useCheckoutStore((s) => s.sendMessage);
  const channel = useCheckoutStore((s) => s.channel);
  const cartItemCount = useCheckoutStore((s) => s.cart.items.reduce((total, item) => total + item.quantity, 0));
  const [input, setInput] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const lastAgentMessage = [...messages].reverse().find((m) => m.role === "agent");
  const lastAgentText = lastAgentMessage ? messageToSpeech(lastAgentMessage) : null;
  const lastAgentKey = lastAgentMessage?.id ?? null;
  const onConfirmTranscript = useCallback(
    (text: string) => sendMessage(text),
    [sendMessage],
  );
  const voice = useVoiceCheckout({
    enabled: channel === "voice",
    busy: isTyping,
    composerLocked: false,
    awaitingAgentPlayback: false,
    latestAgentText: lastAgentText,
    agentPlaybackKey: lastAgentKey,
    onConfirmTranscript,
  });

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
              alignItems: msg.role === "agent" ? "center" : "flex-start",
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
                <div
                  data-neu="message"
                  data-speaker={msg.role === "user" ? "buyer" : "agent"}
                  style={{
                    padding: "10px 14px",
                    borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
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
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
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
        <VoiceComposer voice={voice} />
      ) : (
        <form
          className="chat-panel-composer"
          data-aacp-checkout-composer
          data-cart-present={Boolean(onOpenCart)}
          onSubmit={handleSubmit}
          style={{
            position: "relative",
            display: "flex",
            gap: "8px",
            flexShrink: 0,
            padding: "10px 0 0",
            borderTop: "1px solid var(--bd)",
          }}
        >
          <div className="aacp-composer-field" data-aacp-composer-frame>
            <PerimeterBorder radius="10px" variant="input" />
            <input data-neu="field"
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escreva sua mensagem..."
              aria-label="Mensagem"
              style={{
                flex: 1,
                minWidth: 0,
                padding: "10px 14px",
                borderRadius: "10px",
                border: "1px solid var(--bd)",
                background: "var(--aacp-inset-bg, var(--chip))",
                color: "var(--tx)",
                fontSize: "13px",
                fontFamily: "inherit",
                outline: "none",
              }}
            />
          </div>
          <button data-neu="send"
            type="submit"
            disabled={!input.trim()}
            aria-label="Enviar mensagem"
            style={{
              padding: "10px 16px",
              borderRadius: "10px",
              background: input.trim() ? "var(--aacp-accent, #0f766e)" : "var(--bd)",
              color: "#fff",
              border: "none",
              fontSize: "12px",
              fontWeight: 600,
              cursor: input.trim() ? "pointer" : "not-allowed",
              flex: "none",
            }}
          >
            Enviar
          </button>
          {onOpenCart ? (
            <button
              type="button"
              className="cart-fab-mobile"
              data-neu="floating"
              aria-label="Abrir carrinho"
              onClick={onOpenCart}
              style={{
                position: "absolute",
                top: "calc(50% + 5px)",
                right: 0,
                transform: "translateY(-50%)",
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                border: "none",
                background: "var(--aacp-accent, #0f766e)",
                color: "#fff",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 16px rgba(0,0,0,0.3)",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6h15l-1.5 9h-12z"/><path d="M6 6L5 3H2"/><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/></svg>
              <span style={{ position: "absolute", top: "-4px", right: "-4px", width: "18px", height: "18px", borderRadius: "50%", background: "#ef4444", fontSize: "10px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                {cartItemCount}
              </span>
            </button>
          ) : null}
        </form>
      )}

      <style>{`
        @keyframes bubble-in { from { opacity: 0; transform: translateY(8px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes dot-pulse { 0%,80%,100% { opacity: .3; } 40% { opacity: 1; } }
        @keyframes bounce { from { transform: translateY(0); } to { transform: translateY(-8px); } }
        @media (max-width: 639px) {
          .chat-panel-composer[data-cart-present="true"] { padding-right: 64px !important; }
        }
      `}</style>
    </div>
  );
}
