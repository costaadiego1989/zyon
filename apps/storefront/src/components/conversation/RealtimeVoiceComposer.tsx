import type { RealtimeVoiceCheckoutState } from "@/lib/voice/use-realtime-voice-checkout";

export function RealtimeVoiceComposer({ voice }: { voice: RealtimeVoiceCheckoutState }) {
  const { connecting, connected, listening, speaking, unsupported, hint, toggle } = voice;
  const active = listening || speaking;
  return (
    <div data-aacp-voice-composer style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "10px", padding: "14px 8px 4px" }}>
      <button data-neu="primary" type="button" onClick={toggle} disabled={unsupported || connecting} aria-label={connected ? "Pausar compra por voz" : "Ativar compra por voz"}
        style={{ width: "64px", height: "64px", borderRadius: "50%", border: "none", cursor: unsupported || connecting ? "not-allowed" : "pointer", background: active ? "var(--aacp-accent)" : "var(--aacp-card)", color: active ? "#fff" : "var(--aacp-accent)", display: "flex", alignItems: "center", justifyContent: "center", boxShadow: active ? "0 0 0 6px color-mix(in srgb, var(--aacp-accent) 18%, transparent)" : "0 2px 10px rgba(0,0,0,.08)", opacity: unsupported ? .5 : 1 }}>
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></svg>
      </button>
      <span aria-live="polite" style={{ fontSize: "12px", color: "var(--aacp-muted)", textAlign: "center", minHeight: "18px" }}>{hint}</span>
      <span style={{ fontSize: "10px", color: "var(--aacp-muted)" }}>{connected ? "Voz Realtime conectada" : "Compra por voz disponível a partir do plano Growth"}</span>
    </div>
  );
}
