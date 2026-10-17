"use client";

import { useState } from "react";

export function BuyerHubTrigger({
  onClick,
  hasNotifications = false,
  unreadCount = 0,
}: {
  onClick: () => void;
  hasNotifications?: boolean;
  unreadCount?: number;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <button data-neu="control"
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
      aria-label={`Abrir conta${unreadCount > 0 ? `, ${unreadCount} conversa${unreadCount === 1 ? "" : "s"} não lida${unreadCount === 1 ? "" : "s"}` : ""}`}
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

      {(hasNotifications || unreadCount > 0) && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: "-2px",
            right: "-2px",
            minWidth: unreadCount > 0 ? "17px" : "8px",
            height: unreadCount > 0 ? "17px" : "8px",
            padding: unreadCount > 9 ? "0 3px" : 0,
            display: "grid",
            placeItems: "center",
            fontSize: "10px",
            fontWeight: 700,
            color: "#ffffff",
            borderRadius: "50%",
            background: "#b91c1c",
            border: "1px solid var(--aacp-bg)",
          }}
        >{unreadCount > 0 ? unreadCount > 99 ? "99+" : unreadCount : null}</div>
      )}
    </button>
  );
}
