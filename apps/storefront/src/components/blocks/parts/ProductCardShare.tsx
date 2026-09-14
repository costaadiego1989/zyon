"use client";

import { FaWhatsapp, FaFacebook } from "react-icons/fa";
import { ProductCopyLink } from "../ProductCopyLink";

const iconWrap: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "30px",
  height: "30px",
  borderRadius: "50%",
  background: "color-mix(in srgb, var(--aacp-surface) 80%, transparent)",
  border: "1px solid var(--aacp-line)",
  backdropFilter: "blur(6px)",
  textDecoration: "none",
  cursor: "pointer",
  padding: 0,
};

export function ProductCardShare({ productName, shareUrl }: { productName: string; shareUrl?: string }) {
  const url = shareUrl ?? (typeof window !== "undefined" ? window.location.href : "");
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: "6px",
      }}
    >
      <a data-neu="control"
        href={`https://wa.me/?text=${encodeURIComponent(`${productName} ${url}`.trim())}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Compartilhar no WhatsApp"
        style={{ ...iconWrap, color: "#25D366" }}
      >
        <FaWhatsapp size={15} />
      </a>
      <a data-neu="control"
        href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Compartilhar no Facebook"
        style={{ ...iconWrap, color: "#1877F2" }}
      >
        <FaFacebook size={15} />
      </a>
      <ProductCopyLink url={url} style={{ ...iconWrap, color: "#E4405F" }} />
    </div>
  );
}
