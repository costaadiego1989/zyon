"use client";

import { useState } from "react";

export function BuyerHubTrigger({
  onClick,
  hasNotifications = false,
}: {
  onClick: () => void;
  hasNotifications?: boolean;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title="Minha conta"
      style={{
        width: "30px",
        height: "30px",
        borderRadius: "50%",
        border: hovered ? "1px solid var(--aacp-accent)" : "1px solid var(--aacp-line)",
        background: hovered ? "color-mix(in srgb, var(--aacp-accent) 15%, transparent)" : "var(--aacp-card)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flex: "none",
        padding: 0,
        position: "relative",
        transition: "all 0.15s ease",
      }}
      aria-label="Abrir conta"
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill="none"
        stroke="var(--aacp-muted)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </svg>

      {/* Notification badge */}
      {hasNotifications && (
        <div
          style={{
            position: "absolute",
            top: "-2px",
            right: "-2px",
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            background: "#ff4c6c",
            border: "1px solid var(--aacp-bg)",
          }}
        />
      )}
    </button>
  );
}
