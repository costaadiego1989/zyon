"use client";

import type { BannerBlockData } from "./types";

/**
 * Defense-in-depth: only allow http(s) link targets with the same origin as
 * the storefront or a few trusted hosts. Refuse otherwise.
 */
function isSafeLink(href: string): boolean {
  try {
    const u = new URL(href, "https://localhost");
    if (u.protocol !== "https:" && u.protocol !== "http:") return false;
    return true;
  } catch {
    return false;
  }
}

export default function BannerBlock({
  block,
  onCtaClick,
}: {
  block: BannerBlockData;
  onCtaClick?: (href: string) => void;
}) {
  const showCta = !!block.linkUrl && isSafeLink(block.linkUrl);

  const handleClick = (e: React.MouseEvent) => {
    if (!showCta || !block.linkUrl) return;
    if (onCtaClick) {
      e.preventDefault();
      onCtaClick(block.linkUrl);
    }
  };

  return (
    <figure
      style={{
        margin: "16px 0",
        position: "relative",
        width: "100%",
        borderRadius: "var(--aacp-radius-md)",
        overflow: "hidden",
        background: "var(--aacp-surface-2)",
      }}
    >
      <img
        src={block.imageSrc}
        alt={block.alt}
        loading="lazy"
        style={{
          width: "100%",
          height: "auto",
          maxHeight: "60vh",
          objectFit: "cover",
          display: "block",
        }}
      />
      {(block.caption || showCta) && (
        <figcaption
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "10px",
            padding: "12px 14px",
            background: "var(--aacp-surface)",
            borderTop: "1px solid var(--aacp-line)",
          }}
        >
          {block.caption && (
            <span
              style={{
                fontSize: "14px",
                color: "var(--aacp-fg)",
                lineHeight: 1.4,
                flex: "1 1 auto",
                minWidth: 0,
              }}
            >
              {block.caption}
            </span>
          )}
          {showCta && (
            <a
              href={block.linkUrl}
              onClick={handleClick}
              target="_self"
              rel="noopener noreferrer"
              style={{
                padding: "8px 16px",
                borderRadius: "var(--aacp-radius-pill)",
                background: "var(--aacp-accent)",
                color: "#fff",
                fontSize: "13px",
                fontWeight: 600,
                textDecoration: "none",
                whiteSpace: "nowrap",
              }}
            >
              {block.ctaLabel ?? "Saiba mais"}
            </a>
          )}
        </figcaption>
      )}
    </figure>
  );
}
