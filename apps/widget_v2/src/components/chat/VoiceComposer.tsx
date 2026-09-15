import type { RealtimeVoiceCheckoutState } from "@/lib/voice/use-realtime-voice-checkout";

export function VoiceComposer({ voice }: { voice: RealtimeVoiceCheckoutState }) {
  const { connecting, connected, listening, speaking, unsupported, hint, toggle } = voice;
  const active = listening || speaking;
  return (
    <div data-aacp-checkout-composer style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", flexShrink: 0, padding: "12px 0 4px", borderTop: "1px solid var(--bd)" }}>
      <button data-neu="control" type="button" onClick={toggle} disabled={unsupported || connecting} aria-label={connected ? "Pausar compra por voz" : "Ativar compra por voz"}
        style={{ width: "64px", height: "64px", borderRadius: "50%", border: "none", cursor: unsupported || connecting ? "not-allowed" : "pointer", background: active ? "var(--aacp-accent, #0f766e)" : "var(--chip)", display: "flex", alignItems: "center", justifyContent: "center", transition: "transform 0.15s, background 0.2s", transform: active ? "scale(1.08)" : "scale(1)", boxShadow: active ? "0 0 0 6px color-mix(in srgb, var(--aacp-accent) 20%, transparent)" : "none", opacity: unsupported ? 0.4 : 1 }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={active ? "#fff" : "var(--aacp-accent, #0f766e)"} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" /></svg>
      </button>
      <p style={{ fontSize: "12px", color: "var(--mut)", margin: 0, textAlign: "center", minHeight: "16px" }}>{hint}</p>
      <span style={{ fontSize: "10px", color: "var(--mut)" }}>{connected ? "Voz Realtime conectada" : "Compra por voz disponível a partir do plano Growth"}</span>
    </div>
  );
}
