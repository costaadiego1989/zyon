import { useVoiceCheckout } from "@/lib/voice/use-voice-checkout";

export function VoiceComposer({ voice }: { voice: ReturnType<typeof useVoiceCheckout> }) {
  const { listening, speaking, unsupported, hint, pendingTurn, handleMicPress, confirmPendingTurn, discardPendingTurn, retryPendingTurn } = voice;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: "10px",
        flexShrink: 0,
        padding: "12px 0 4px",
        borderTop: "1px solid var(--bd)",
      }}
    >
      {pendingTurn && (
        <div
          style={{
            width: "100%",
            padding: "12px 14px",
            borderRadius: "12px",
            background: "var(--chip)",
            border: "1px solid var(--bd)",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          <div style={{ fontSize: "13px", color: "var(--tx)", lineHeight: 1.4 }}>
            "{pendingTurn.displayTranscript}"
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button
              type="button"
              onClick={() => void confirmPendingTurn()}
              style={{
                flex: 1, padding: "8px", borderRadius: "8px", border: "none",
                background: "var(--aacp-accent, #0f766e)", color: "#fff",
                fontSize: "12px", fontWeight: 600, cursor: "pointer",
              }}
            >
              Confirmar
            </button>
            <button
              type="button"
              onClick={retryPendingTurn}
              style={{
                padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--bd)",
                background: "transparent", color: "var(--tx)",
                fontSize: "12px", fontWeight: 600, cursor: "pointer",
              }}
            >
              Repetir
            </button>
            <button
              type="button"
              onClick={discardPendingTurn}
              aria-label="Descartar"
              style={{
                padding: "8px 12px", borderRadius: "8px", border: "1px solid var(--bd)",
                background: "transparent", color: "var(--mut)",
                fontSize: "12px", cursor: "pointer",
              }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {!pendingTurn && (
        <button
          type="button"
          onClick={handleMicPress}
          disabled={unsupported || speaking}
          aria-label={listening ? "Parar de ouvir" : "Falar"}
          style={{
            width: "64px", height: "64px", borderRadius: "50%",
            border: "none", cursor: unsupported || speaking ? "not-allowed" : "pointer",
            background: listening ? "var(--aacp-accent, #0f766e)" : "var(--chip)",
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "transform 0.15s, background 0.2s",
            transform: listening ? "scale(1.08)" : "scale(1)",
            boxShadow: listening ? "0 0 0 6px color-mix(in srgb, var(--aacp-accent) 20%, transparent)" : "none",
            opacity: unsupported ? 0.4 : 1,
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
            stroke={listening ? "#fff" : "var(--aacp-accent, #0f766e)"}
            strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </button>
      )}

      <p style={{ fontSize: "12px", color: "var(--mut)", margin: 0, textAlign: "center", minHeight: "16px" }}>
        {hint}
      </p>
    </div>
  );
}
