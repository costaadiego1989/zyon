"use client";

import { FaWhatsapp, FaFacebook, FaInstagram } from "react-icons/fa";

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

export function ProductCardShare({ productName }: { productName: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "row",
        gap: "6px",
      }}
    >
      <a
        href={`https://wa.me/?text=${encodeURIComponent(productName + (typeof window !== "undefined" ? " " + window.location.href : ""))}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Compartilhar no WhatsApp"
        style={{ ...iconWrap, color: "#25D366" }}
      >
        <FaWhatsapp size={15} />
      </a>
      <a
        href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Compartilhar no Facebook"
        style={{ ...iconWrap, color: "#1877F2" }}
      >
        <FaFacebook size={15} />
      </a>
      <button
        type="button"
        aria-label="Copiar link para Instagram"
        onClick={() => {
          if (typeof navigator !== "undefined") {
            navigator.clipboard.writeText(window.location.href).catch(() => {});
          }
        }}
        style={{ ...iconWrap, color: "#E4405F" }}
      >
        <FaInstagram size={15} />
      </button>
    </div>
  );
}
