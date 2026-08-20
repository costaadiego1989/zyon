export function PulseAgentOrb({ size = 96 }: { size?: number }) {
  const eyeW = Math.max(2, Math.round(size * 0.086));
  const eyeH = Math.max(3, Math.round(size * 0.125));
  const eyeGap = Math.max(2, Math.round(size * 0.102));
  const glowInset = -Math.max(12, Math.round(size * 0.14));
  const ringInset = -Math.max(4, Math.round(size * 0.05));

  return (
    <div aria-hidden style={{ position: "relative", width: size, height: size, flexShrink: 0, animation: "orbFloat 6s ease-in-out infinite" }}>
      <div style={{ position: "absolute", inset: ringInset, borderRadius: "50%", border: "1px solid var(--aacp-accent, #0f766e)", animation: "waveRing 2.6s ease-out infinite" }} />
      <div style={{ position: "absolute", inset: glowInset, borderRadius: "50%", background: "var(--aacp-accent, #0f766e)", filter: "blur(20px)", opacity: 0.38, pointerEvents: "none" }} />
      <div style={{ position: "absolute", inset: 0, borderRadius: "50%", background: `radial-gradient(120% 120% at 30% 25%, rgba(255, 255, 255, 0.92), rgba(255, 255, 255, 0) 42%), var(--aacp-accent, #0f766e)`, boxShadow: "inset 0 0 30px rgba(255, 255, 255, 0.28), 0 0 28px color-mix(in srgb, var(--aacp-accent, #0f766e) 50%, transparent)", zIndex: 1 }} />
      <div style={{ position: "absolute", inset: 0, zIndex: 2, display: "flex", alignItems: "center", justifyContent: "center", gap: `${eyeGap}px`, pointerEvents: "none", animation: "eyeLookLR 2.6s ease-in-out infinite" }}>
        <span style={{ width: eyeW, height: eyeH, borderRadius: "50%", background: "#fff", boxShadow: "0 0 10px rgba(0,0,0,0.18)", animation: "eyeBlink 4s ease-in-out infinite" }} />
        <span style={{ width: eyeW, height: eyeH, borderRadius: "50%", background: "#fff", boxShadow: "0 0 10px rgba(0,0,0,0.18)", animation: "eyeBlink 4s ease-in-out infinite", animationDelay: "0.12s" }} />
      </div>
    </div>
  );
}
