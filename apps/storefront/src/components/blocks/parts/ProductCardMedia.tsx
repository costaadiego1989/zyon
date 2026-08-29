"use client";

import type { ProductCardBlock as ProductCardBlockType } from "@/lib/types";
import { getInitial } from "./util";
import { ProductCardShare } from "./ProductCardShare";

export function ProductCardMedia({
  data,
  hasDiscount,
  onQuickReply,
}: {
  data: ProductCardBlockType["data"];
  hasDiscount: boolean;
  onQuickReply?: (option: string) => void;
}) {
  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "200px",
        background: data.image
          ? "linear-gradient(180deg, var(--aacp-surface-2) 0%, var(--aacp-surface-3) 100%)"
          : "linear-gradient(135deg, var(--aacp-surface-2) 0%, var(--aacp-surface-3) 100%)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {data.image ? (
        <img
          src={data.image}
          alt={data.name}
          style={{
            maxWidth: "100%",
            maxHeight: "100%",
            width: "auto",
            height: "auto",
            objectFit: "contain",
            display: "block",
          }}
          loading="lazy"
        />
      ) : (
        <span
          style={{
            fontFamily: "var(--aacp-font-display)",
            fontSize: "72px",
            fontWeight: 800,
            lineHeight: 1,
            color: "color-mix(in srgb, var(--aacp-accent) 30%, transparent)",
            letterSpacing: "-0.04em",
            userSelect: "none",
          }}
        >
          {getInitial(data.name)}
        </span>
      )}

      <div
        style={{
          position: "absolute",
          top: "12px",
          left: "12px",
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          alignItems: "flex-start",
        }}
      >
        {hasDiscount && (
          <span
            style={{
              background: "var(--aacp-accent)",
              color: "#fff",
              fontSize: "11px",
              fontWeight: 700,
              padding: "5px 9px",
              borderRadius: "999px",
              letterSpacing: "0.05em",
              boxShadow:
                "0 4px 12px color-mix(in srgb, var(--aacp-accent) 35%, transparent)",
            }}
          >
            -{data.discountPercent}%
          </span>
        )}
        <ProductCardShare productName={data.name} />
      </div>

      <button
        type="button"
        aria-label="Adicionar à lista de desejos"
        onClick={() => onQuickReply?.(`Adicionar ${data.name} à lista de desejos`)}
        style={{
          position: "absolute",
          top: "12px",
          right: "12px",
          width: "34px",
          height: "34px",
          borderRadius: "50%",
          background: "color-mix(in srgb, var(--aacp-surface) 80%, transparent)",
          border: "1px solid var(--aacp-line)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          color: "var(--aacp-muted)",
          backdropFilter: "blur(6px)",
          transition: "all 0.15s ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "#ef4444";
          e.currentTarget.style.borderColor = "#ef4444";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "var(--aacp-muted)";
          e.currentTarget.style.borderColor = "var(--aacp-line)";
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
        </svg>
      </button>
    </div>
  );
}
