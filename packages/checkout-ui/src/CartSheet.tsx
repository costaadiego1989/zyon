import React from "react";
import type { CartSheetProps } from "./types";

function formatPrice(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export function CartSheet({ open, cart, onClose, onCheckout, onUpdateQty, onRemoveItem, onViewCart }: CartSheetProps & { onViewCart?: () => void }) {
  if (!open) return null;

  return (
    <>
      <style>{`
        @keyframes ckui-drawer-in { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes ckui-scrim-in { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      {/* Scrim */}
      <div
        onClick={onClose}
        role="presentation"
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(0, 0, 0, 0.45)",
          zIndex: 95,
          animation: "ckui-scrim-in 0.2s ease both",
        }}
      />

      {/* Drawer lateral (right side) */}
      <div
        role="dialog"
        aria-label="Carrinho"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          width: "min(340px, 85vw)",
          zIndex: 96,
          background: "var(--aacp-surface, #0f0f16)",
          borderLeft: "1px solid var(--aacp-line, rgba(255,255,255,0.1))",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: "ckui-drawer-in 0.28s cubic-bezier(0.22, 1, 0.36, 1) both",
        }}
      >
        {/* Header */}
        <div style={{ padding: "16px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--aacp-line, rgba(255,255,255,0.08))" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--aacp-accent, #0f766e)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="9" cy="21" r="1" />
              <circle cx="20" cy="21" r="1" />
              <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
            </svg>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--aacp-fg, #f5f5f7)" }}>
              Carrinho
            </span>
            {cart.itemCount > 0 && (
              <span style={{ fontSize: "11px", color: "var(--aacp-muted, #8b8b95)", background: "var(--aacp-surface-2, rgba(255,255,255,0.05))", padding: "2px 8px", borderRadius: "10px", fontWeight: 600 }}>
                {cart.itemCount}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar carrinho"
            style={{ width: "28px", height: "28px", borderRadius: "50%", border: "1px solid var(--aacp-line, rgba(255,255,255,0.1))", background: "transparent", color: "var(--aacp-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Items */}
        <div style={{ flex: 1, overflowY: "auto", padding: "12px 18px" }}>
          {cart.items.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 12px", color: "var(--aacp-muted)" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ margin: "0 auto 12px", opacity: 0.4 }}>
                <circle cx="9" cy="21" r="1" />
                <circle cx="20" cy="21" r="1" />
                <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
              </svg>
              <p style={{ fontSize: "13px", fontWeight: 600, color: "var(--aacp-fg)", margin: "0 0 4px" }}>Carrinho vazio</p>
              <p style={{ fontSize: "11.5px", margin: 0 }}>Adicione produtos pelo chat.</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
              {cart.items.map((item) => (
                <div
                  key={item.variantId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    padding: "12px 0",
                    borderBottom: "1px solid var(--aacp-line, rgba(255,255,255,0.06))",
                  }}
                >
                  {/* Product info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: "12.5px", fontWeight: 600, color: "var(--aacp-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.productName}
                    </p>
                    <p style={{ margin: "2px 0 0", fontSize: "10.5px", color: "var(--aacp-muted)" }}>
                      {formatPrice(item.price)} un.
                    </p>
                  </div>

                  {/* Qty controls */}
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <button
                      type="button"
                      onClick={() => item.quantity <= 1 ? onRemoveItem(item.variantId) : onUpdateQty(item.variantId, item.quantity - 1)}
                      style={{ width: "22px", height: "22px", borderRadius: "6px", border: "1px solid var(--aacp-line)", background: "transparent", color: "var(--aacp-fg)", fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                      aria-label="Diminuir"
                    >
                      −
                    </button>
                    <span style={{ fontSize: "11.5px", fontWeight: 600, minWidth: "14px", textAlign: "center", color: "var(--aacp-fg)" }}>
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => onUpdateQty(item.variantId, item.quantity + 1)}
                      style={{ width: "22px", height: "22px", borderRadius: "6px", border: "1px solid var(--aacp-line)", background: "transparent", color: "var(--aacp-fg)", fontSize: "13px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                      aria-label="Aumentar"
                    >
                      +
                    </button>
                  </div>

                  {/* Line total */}
                  <span style={{ fontSize: "12px", fontWeight: 700, color: "var(--aacp-fg)", fontVariantNumeric: "tabular-nums", minWidth: "60px", textAlign: "right" }}>
                    {formatPrice(item.subtotal)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer — totals + CTAs */}
        {cart.items.length > 0 && (
          <div style={{ padding: "14px 18px 18px", borderTop: "1px solid var(--aacp-line)", display: "flex", flexDirection: "column", gap: "10px" }}>
            {/* Totals */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <span style={{ fontSize: "11.5px", color: "var(--aacp-muted)" }}>Subtotal</span>
              <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--aacp-fg)", fontVariantNumeric: "tabular-nums" }}>{formatPrice(cart.subtotal)}</span>
            </div>
            {cart.discount > 0 && (
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <span style={{ fontSize: "11.5px", color: "var(--aacp-success, #34d399)" }}>Desconto</span>
                <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--aacp-success, #34d399)" }}>-{formatPrice(cart.discount)}</span>
              </div>
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", paddingTop: "8px", borderTop: "1px solid var(--aacp-line)" }}>
              <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--aacp-fg)" }}>Total</span>
              <span style={{ fontSize: "16px", fontWeight: 800, color: "var(--aacp-accent)", fontVariantNumeric: "tabular-nums" }}>{formatPrice(cart.total)}</span>
            </div>

            {/* CTA: Finalizar Pedido (primary) */}
            <button
              type="button"
              onClick={onCheckout}
              style={{
                width: "100%",
                height: "44px",
                borderRadius: "10px",
                border: "none",
                background: "var(--aacp-accent, #0f766e)",
                color: "#fff",
                fontSize: "13px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                boxShadow: "0 4px 14px color-mix(in srgb, var(--aacp-accent, #0f766e) 30%, transparent)",
                transition: "transform 0.15s ease, box-shadow 0.15s ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; }}
            >
              Finalizar pedido
            </button>

            {/* CTA: Ver carrinho (secondary) */}
            {onViewCart && (
              <button
                type="button"
                onClick={onViewCart}
                style={{
                  width: "100%",
                  height: "38px",
                  borderRadius: "10px",
                  border: "1px solid var(--aacp-line)",
                  background: "transparent",
                  color: "var(--aacp-muted)",
                  fontSize: "12px",
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "border-color 0.15s ease, color 0.15s ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aacp-accent)"; e.currentTarget.style.color = "var(--aacp-fg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--aacp-line)"; e.currentTarget.style.color = "var(--aacp-muted)"; }}
              >
                Ver carrinho completo
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
