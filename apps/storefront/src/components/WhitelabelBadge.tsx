"use client";

export default function WhitelabelBadge({ show }: { show?: boolean }) {
  if (!show) return null;
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: "8px 0",
        width: "100%",
        background: "var(--aacp-accent, #0f766e)",
        flex: "none",
      }}
    >
      <span
        style={{
          fontSize: "10px",
          fontWeight: 600,
          color: "#ffffff",
          letterSpacing: "0.4px",
        }}
      >
        Powered by Zyon
      </span>
    </div>
  );
}
