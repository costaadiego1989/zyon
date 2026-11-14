"use client";

import type { ButtonBlockData } from "./types";

function isSafeHref(href: string): boolean {
  try {
    const u = new URL(href, "https://localhost");
    return u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:" || u.protocol === "tel:";
  } catch {
    return false;
  }
}

const VARIANT_STYLE: Record<ButtonBlockData["variant"], React.CSSProperties> = {
  primary: {
    background: "var(--aacp-accent)",
    color: "var(--aacp-on-accent, #f8f8f8)",
    border: "1px solid var(--aacp-accent)",
  },
  secondary: {
    background: "var(--aacp-surface)",
    color: "var(--aacp-fg)",
    border: "1px solid var(--aacp-line-strong)",
  },
};

export default function ButtonBlock({
  block,
  onCtaClick,
}: {
  block: ButtonBlockData;
  onCtaClick?: (href: string) => void;
}) {
  const href =
    block.linkType === "add_to_cart"
      ? "#checkout"
      : block.linkType === "product" && block.productId
        ? `?show=content&product=${encodeURIComponent(block.productId)}`
        : block.href;
  if (!href || !isSafeHref(href)) return null;
  const variant = VARIANT_STYLE[block.variant] ?? VARIANT_STYLE.primary;

  const handleClick = (e: React.MouseEvent) => {
    if (onCtaClick) {
      e.preventDefault();
      onCtaClick(href);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "flex-start",
        margin: "14px 0",
      }}
    >
      <a
        href={href}
        onClick={handleClick}
        target="_self"
        rel="noopener noreferrer"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "10px 22px",
          borderRadius: "var(--aacp-radius-pill)",
          fontFamily: "var(--aacp-font)",
          fontSize: "14px",
          fontWeight: 600,
          textDecoration: "none",
          cursor: "pointer",
          ...variant,
        }}
      >
        {block.label}
      </a>
    </div>
  );
}
