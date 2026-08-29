"use client";

import { FaWhatsapp, FaFacebook, FaInstagram } from "react-icons/fa";

export function ProductCardShare({ productName }: { productName: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "10px 18px",
        borderTop: "1px solid var(--aacp-line)",
      }}
    >
      <span style={{ fontSize: "11px", color: "var(--aacp-muted)", fontWeight: 500 }}>
        Compartilhar:
      </span>
      <a
        href={`https://wa.me/?text=${encodeURIComponent(productName + (typeof window !== "undefined" ? " " + window.location.href : ""))}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Compartilhar no WhatsApp"
        style={{ display: "flex", alignItems: "center", padding: "4px", borderRadius: "6px", color: "#25D366", textDecoration: "none" }}
      >
        <FaWhatsapp size={18} />
      </a>
      <a
        href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(typeof window !== "undefined" ? window.location.href : "")}`}
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Compartilhar no Facebook"
        style={{ display: "flex", alignItems: "center", padding: "4px", borderRadius: "6px", color: "#1877F2", textDecoration: "none" }}
      >
        <FaFacebook size={18} />
      </a>
      <button
        type="button"
        aria-label="Copiar link para Instagram"
        onClick={() => {
          if (typeof navigator !== "undefined") {
            navigator.clipboard.writeText(window.location.href).catch(() => {});
          }
        }}
        style={{ display: "flex", alignItems: "center", padding: "4px", borderRadius: "6px", color: "#E4405F", background: "none", border: "none", cursor: "pointer" }}
      >
        <FaInstagram size={18} />
      </button>
    </div>
  );
}
