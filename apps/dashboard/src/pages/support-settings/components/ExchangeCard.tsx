import React from "react";
import { ImageGallery } from "./ImageGallery.js";
import type { SupportMessageMetadata } from "@zyon/shared-types";

interface ExchangeCardProps {
  metadata: Extract<SupportMessageMetadata, { kind: "return_request" }>;
}

export function ExchangeCard({ metadata }: ExchangeCardProps) {
  const { reason, reasonLabel, items, imageUrls, orderRef } = metadata;

  const reasonColorClass = {
    DEFECTIVE: "exchange-card-badge--error",
    DAMAGED_IN_TRANSIT: "exchange-card-badge--error",
    WRONG_ITEM: "exchange-card-badge--warning",
    NOT_AS_DESCRIBED: "exchange-card-badge--warning",
    CHANGED_MIND: "exchange-card-badge--info",
    OTHER: "exchange-card-badge--muted",
  }[reason] || "exchange-card-badge--muted";

  return (
    <div
      className="exchange-card"
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: "var(--radius-md)",
        padding: "12px",
        backgroundColor: "var(--color-surface-raised)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "8px",
        }}
      >
        <span className={`exchange-card-badge ${reasonColorClass}`}>
          {reasonLabel}
        </span>
        {orderRef && (
          <span
            style={{
              fontSize: "11px",
              color: "var(--color-text-muted)",
              fontWeight: 500,
            }}
          >
            Pedido: {orderRef}
          </span>
        )}
      </div>

      <div
        style={{
          marginBottom: "8px",
        }}
      >
        {items.map((item, idx) => (
          <div
            key={idx}
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "flex-start",
              padding: "6px 0",
              borderTop: idx > 0 ? "1px solid var(--color-border)" : undefined,
            }}
          >
            {item.imageUrl && (
              <img
                src={item.imageUrl}
                alt={item.name}
                style={{
                  width: "48px",
                  height: "48px",
                  borderRadius: "4px",
                  objectFit: "cover",
                  flexShrink: 0,
                }}
              />
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: "13px",
                  fontWeight: 500,
                  color: "var(--color-text)",
                  wordBreak: "break-word",
                }}
              >
                {item.name}
              </div>
              <div
                style={{
                  fontSize: "12px",
                  color: "var(--color-text-muted)",
                  marginTop: "2px",
                }}
              >
                ×{item.quantity}
              </div>
            </div>
          </div>
        ))}
      </div>

      {imageUrls && imageUrls.length > 0 && (
        <div style={{ marginTop: "12px" }}>
          <div
            style={{
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--color-text-muted)",
              textTransform: "uppercase",
              marginBottom: "8px",
            }}
          >
            Evidência
          </div>
          <ImageGallery images={imageUrls} />
        </div>
      )}
    </div>
  );
}
