"use client";

import { ReturnRequestForm } from "./ReturnRequestForm";
import { useSupportPanel } from "@/lib/viewmodels/useSupportPanel";

interface SupportPanelProps {
  open: boolean;
  onClose: () => void;
  merchantId?: string;
  agentName?: string;
}

export default function SupportPanel({ open, onClose, merchantId, agentName }: SupportPanelProps) {
  const agent = agentName || "Assistente";
  const {
    messages,
    input,
    setInput,
    isLoading,
    view,
    setView,
    returnDone,
    setReturnDone,
    faqItems,
    threadRef,
    inputRef,
    handleSubmit,
    handleFaqClick,
    resetToWelcome,
  } = useSupportPanel({ open, merchantId, agentName });

  const showBack = view !== "welcome" || messages.length > 0;

  return (
    <>
      <style>{`
        @keyframes panelSlideUp { from { transform: translateY(100px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes backdropFade { from { opacity: 0; } to { opacity: 1; } }
        @media (max-width: 480px) {
          #support-panel { width: calc(100vw - 32px) !important; bottom: var(--bottom-offset, -480px) !important; }
        }
      `}</style>

      {/* Backdrop */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9998,
            background: "rgba(0,0,0,0.3)",
            animation: "backdropFade 0.3s ease",
          }}
        />
      )}

      {/* Panel Container */}
      <div
        id="support-panel"
        style={{
          position: "fixed",
          bottom: open ? "80px" : "-480px",
          right: "16px",
          zIndex: 9999,
          width: "340px",
          maxWidth: "calc(100vw - 32px)",
          height: "480px",
          borderRadius: "16px",
          background: "var(--aacp-surface, #0f0f16)",
          border: "1px solid var(--aacp-line, rgba(255,255,255,0.1))",
          boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: open ? "panelSlideUp 0.3s cubic-bezier(0.25, 1, 0.5, 1)" : "none",
          transition: "bottom 0.3s cubic-bezier(0.25, 1, 0.5, 1)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 14px",
            borderBottom: "1px solid var(--aacp-line, rgba(255,255,255,0.1))",
            flex: "none",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1 }}>
            <div
              style={{
                width: "28px",
                height: "28px",
                borderRadius: "8px",
                background: "var(--aacp-accent, #0f766e)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" />
              </svg>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--aacp-fg, #f5f5f7)" }}>
                Central de Ajuda
              </div>
              <div style={{ fontSize: "11px", color: "var(--aacp-muted, #8b8b95)", display: "flex", alignItems: "center", gap: "4px" }}>
                <span style={{ width: "4px", height: "4px", borderRadius: "50%", background: "var(--aacp-success, #34d399)" }} />
                {agent} · Suporte
              </div>
            </div>
          </div>

          {/* Back to menu — only when in a chat/return view so the buyer isn't stuck */}
          {showBack && (
            <button
              type="button"
              onClick={resetToWelcome}
              aria-label="Voltar ao menu"
              style={{
                background: "none",
                border: "none",
                padding: "4px 8px",
                cursor: "pointer",
                color: "var(--aacp-muted, #8b8b95)",
                display: "flex",
                alignItems: "center",
                gap: "4px",
                flex: "none",
                fontSize: "11px",
                fontFamily: "inherit",
                transition: "color 0.15s ease",
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "var(--aacp-fg)")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "var(--aacp-muted)")}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
              Voltar
            </button>
          )}

          {/* Close button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar suporte"
            style={{
              background: "none",
              border: "none",
              padding: "4px",
              cursor: "pointer",
              color: "var(--aacp-muted, #8b8b95)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flex: "none",
              transition: "color 0.15s ease",
            }}
            onMouseEnter={(e) => e.currentTarget.style.color = "var(--aacp-fg)"}
            onMouseLeave={(e) => e.currentTarget.style.color = "var(--aacp-muted)"}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Thread / Body */}
        <div
          ref={threadRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "14px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            minHeight: 0,
          }}
        >
          {view === "return" ? (
            returnDone ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", textAlign: "center", flex: 1, justifyContent: "center" }}>
                <div style={{ fontSize: 32 }}>✅</div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--aacp-fg, #f5f5f7)" }}>Solicitação enviada</div>
                <div style={{ fontSize: 12, color: "var(--aacp-muted, #8b8b95)", lineHeight: 1.5 }}>
                  Recebemos sua solicitação de troca/devolução. A loja vai analisar e te retornar.
                </div>
                <button
                  type="button"
                  onClick={() => { setReturnDone(false); setView("welcome"); }}
                  style={{ marginTop: 4, padding: "8px 16px", borderRadius: 10, border: "1px solid var(--aacp-line, rgba(255,255,255,0.1))", background: "transparent", color: "var(--aacp-fg, #f5f5f7)", font: "500 13px inherit", cursor: "pointer" }}
                >
                  Voltar
                </button>
              </div>
            ) : (
              <ReturnRequestForm
                merchantId={merchantId ?? ""}
                onSuccess={() => setReturnDone(true)}
                onCancel={() => setView("welcome")}
              />
            )
          ) : view === "welcome" && messages.length === 0 ? (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                alignItems: "center",
                textAlign: "center",
                flex: 1,
                justifyContent: "center",
              }}
            >
              <div style={{ fontSize: "32px" }}>👋</div>
              <div>
                <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--aacp-fg, #f5f5f7)", marginBottom: "4px" }}>
                  Oi! Sou o assistente de suporte.
                </div>
                <div style={{ fontSize: "12px", color: "var(--aacp-muted, #8b8b95)", lineHeight: 1.5 }}>
                  Posso ajudar com dúvidas sobre entrega, pagamento, trocas e muito mais. Como posso te ajudar?
                </div>
              </div>

              {/* Fixed action: Troca e Devolução */}
              <button
                type="button"
                onClick={() => { setReturnDone(false); setView("return"); }}
                style={{
                  width: "100%",
                  background: "var(--aacp-accent, #0f766e)",
                  border: "none",
                  borderRadius: "10px",
                  padding: "12px",
                  color: "#fff",
                  fontSize: "13px",
                  fontWeight: 600,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  fontFamily: "inherit",
                }}
              >
                <span>📦</span>
                <span style={{ flex: 1, textAlign: "left" }}>Troca e Devolução</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="9 18 15 12 9 6" />
                </svg>
              </button>

              {/* FAQ buttons */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px", width: "100%" }}>
                {faqItems.map((item) => (
                  <button
                    key={item.question}
                    onClick={() => handleFaqClick(item.question)}
                    disabled={isLoading}
                    style={{
                      background: "var(--aacp-card, rgba(255,255,255,0.05))",
                      border: "1px solid var(--aacp-line, rgba(255,255,255,0.1))",
                      borderRadius: "10px",
                      padding: "10px 12px",
                      color: "var(--aacp-fg, #f5f5f7)",
                      fontSize: "12px",
                      cursor: isLoading ? "not-allowed" : "pointer",
                      opacity: isLoading ? 0.5 : 1,
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      fontFamily: "inherit",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      if (!isLoading) {
                        e.currentTarget.style.background = "var(--aacp-surface-2, rgba(255,255,255,0.08))";
                        e.currentTarget.style.borderColor = "var(--aacp-accent, #0f766e)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "var(--aacp-card, rgba(255,255,255,0.05))";
                      e.currentTarget.style.borderColor = "var(--aacp-line, rgba(255,255,255,0.1))";
                    }}
                  >
                    <span>{item.icon || "❓"}</span>
                    <span style={{ flex: 1, textAlign: "left" }}>{item.question}</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </button>
                ))}
              </div>

              <div style={{ fontSize: "10px", color: "var(--aacp-muted, #8b8b95)", marginTop: "8px", display: "flex", alignItems: "center", gap: "4px" }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Respostas verificadas
              </div>
            </div>
          ) : (
            <>
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  style={{
                    display: "flex",
                    flexDirection: msg.role === "user" ? "row-reverse" : "row",
                    alignItems: "flex-end",
                    gap: "6px",
                    animation: "bubble-in 0.2s ease both",
                  }}
                >
                  {(msg.role === "agent" || msg.role === "merchant") && (
                    <div
                      style={{
                        width: "22px",
                        height: "22px",
                        borderRadius: "50%",
                        background: msg.role === "merchant" ? "#2563eb" : "var(--aacp-accent, #0f766e)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flex: "none",
                        fontSize: "10px",
                      }}
                    >
                      {msg.role === "merchant" ? "👤" : "💬"}
                    </div>
                  )}
                  <div style={{ display: "flex", flexDirection: "column", maxWidth: "calc(100% - 32px)" }}>
                    {msg.role === "merchant" && (
                      <span style={{ fontSize: "9px", fontWeight: 600, color: "#60a5fa", marginBottom: 2, textTransform: "uppercase", letterSpacing: "0.04em" }}>{msg.agentName || "Atendente"}</span>
                    )}
                    <div
                      style={{
                        padding: "8px 12px",
                        borderRadius: msg.role === "user" ? "10px 10px 4px 10px" : "10px 10px 10px 4px",
                        background: msg.role === "user"
                          ? "var(--aacp-accent, #0f766e)"
                          : msg.role === "merchant"
                            ? "rgba(37, 99, 235, 0.15)"
                            : "var(--aacp-card, rgba(255,255,255,0.05))",
                        color: msg.role === "user" ? "#fff" : "var(--aacp-fg, #f5f5f7)",
                        fontSize: "12px",
                        lineHeight: 1.4,
                        wordWrap: "break-word",
                        border: msg.role === "user" ? "none" : msg.role === "merchant" ? "1px solid rgba(37,99,235,0.3)" : "1px solid var(--aacp-line, rgba(255,255,255,0.1))",
                      }}
                    >
                      {msg.text}
                    </div>
                  </div>
                </div>
              ))}

              {isLoading && (
                <div style={{ display: "flex", gap: "6px", alignItems: "flex-end" }}>
                  <div
                    style={{
                      width: "22px",
                      height: "22px",
                      borderRadius: "50%",
                      background: "var(--aacp-accent, #0f766e)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flex: "none",
                      fontSize: "10px",
                    }}
                  >
                    💬
                  </div>
                  <div
                    style={{
                      padding: "8px 12px",
                      borderRadius: "10px 10px 10px 4px",
                      background: "var(--aacp-card, rgba(255,255,255,0.05))",
                      border: "1px solid var(--aacp-line, rgba(255,255,255,0.1))",
                      display: "flex",
                      gap: "3px",
                      alignItems: "center",
                    }}
                  >
                    <span
                      style={{
                        width: "3px",
                        height: "3px",
                        borderRadius: "50%",
                        background: "var(--aacp-muted, #8b8b95)",
                        animation: "dot-pulse 1.2s infinite",
                        animationDelay: "0s",
                      }}
                    />
                    <span
                      style={{
                        width: "3px",
                        height: "3px",
                        borderRadius: "50%",
                        background: "var(--aacp-muted, #8b8b95)",
                        animation: "dot-pulse 1.2s infinite",
                        animationDelay: "0.2s",
                      }}
                    />
                    <span
                      style={{
                        width: "3px",
                        height: "3px",
                        borderRadius: "50%",
                        background: "var(--aacp-muted, #8b8b95)",
                        animation: "dot-pulse 1.2s infinite",
                        animationDelay: "0.4s",
                      }}
                    />
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Composer */}
        <div
          style={{
            padding: "10px 14px",
            borderTop: "1px solid var(--aacp-line, rgba(255,255,255,0.1))",
            flex: "none",
          }}
        >
          <form onSubmit={handleSubmit} style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={isLoading ? "Aguarde..." : "Digite sua mensagem…"}
              disabled={isLoading}
              style={{
                flex: 1,
                minWidth: 0,
                background: "var(--aacp-card, rgba(255,255,255,0.05))",
                border: "1px solid var(--aacp-line, rgba(255,255,255,0.1))",
                borderRadius: "8px",
                padding: "8px 10px",
                color: "var(--aacp-fg, #f5f5f7)",
                fontSize: "12px",
                outline: "none",
                transition: "border-color 0.15s ease",
              }}
              onFocus={(e) => e.currentTarget.style.borderColor = "var(--aacp-accent)"}
              onBlur={(e) => e.currentTarget.style.borderColor = "var(--aacp-line)"}
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "8px",
                border: "none",
                background: "var(--aacp-accent, #0f766e)",
                color: "#fff",
                cursor: !input.trim() || isLoading ? "not-allowed" : "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: "none",
                opacity: !input.trim() || isLoading ? 0.5 : 1,
                transition: "opacity 0.15s ease",
              }}
              aria-label="Enviar mensagem"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14M13 6l6 6-6 6" />
              </svg>
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
