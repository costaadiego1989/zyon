export function VoiceChannelButton({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  return (
    <button data-neu="control" data-aacp-voice-channel={active ? "voice" : "chat"} type="button"
      onClick={onToggle} aria-pressed={active}
      aria-label={active ? "Desativar compra por voz" : "Ativar compra por voz"}
      title={active ? "Mudar para chat" : "Mudar para voz"}
      style={{ width: "44px", height: "44px", borderRadius: "50%", border: "1px solid var(--aacp-accent)",
        background: "var(--aacp-accent)", color: "var(--aacp-on-accent, #f8faf9)", cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center", flex: "none", padding: 0 }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {active ? <path d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5.6A8.5 8.5 0 0 1 12.5 3 8.38 8.38 0 0 1 21 11.5z" /> :
          <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3M8 21h8" /></>}
      </svg>
    </button>
  );
}
