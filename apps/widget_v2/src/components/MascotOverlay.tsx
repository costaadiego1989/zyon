import { PulseAgentOrb } from "./PulseAgentOrb";

/**
 * Full-screen loading/waiting overlay with the mascot orb.
 * Used for: initial checkout loading, payment verification waiting.
 */
export function MascotOverlay({
  message = "Carregando...",
  sub,
}: {
  message?: string;
  sub?: string;
}) {
  return (
    <div
      className="mascot-overlay"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        gap: "20px",
        padding: "40px 24px",
        textAlign: "center",
      }}
    >
      <PulseAgentOrb placement="chatLoading" active />
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        <p
          style={{
            fontSize: "15px",
            fontWeight: 600,
            color: "var(--tx)",
            margin: 0,
            animation: "fadeInUp 0.4s ease-out both",
          }}
        >
          {message}
        </p>
        {sub && (
          <p
            style={{
              fontSize: "12px",
              color: "var(--mut)",
              margin: 0,
              animation: "fadeInUp 0.5s ease-out both 0.1s",
            }}
          >
            {sub}
          </p>
        )}
      </div>
    </div>
  );
}
