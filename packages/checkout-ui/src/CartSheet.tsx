import React from "react";
import type { CartSheetProps } from "./types";

function formatPrice(value: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value);
}

export type CartSheetPosition = "bottom" | "right";

export function CartSheet({ open, cart, onClose, onCheckout, onUpdateQty, onRemoveItem, onViewCart, position = "bottom" }: CartSheetProps & { onViewCart?: () => void; position?: CartSheetPosition }) {
  if (!open) return null;

  const isBottom = position === "bottom";

  return (
    <>
      <style>{`
        @keyframes ckui-sheet-up { from { transform: translateY(100%); } to { transform: translateY(0); } }
        @keyframes ckui-drawer-right { from { transform: translateX(100%); } to { transform: translateX(0); } }
        @keyframes ckui-scrim-in { from { opacity: 0; } to { opacity: 1; } }
      `}</style>

      {/* Scrim */}
      <div
        onClick={onClose}
        role="presentation"
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(0, 0, 0, 0.45)",
          zIndex: 9995,
          animation: "ckui-scrim-in 0.2s ease both",
        }}
      />

      {/* Sheet / Drawer */}
      <div
        role="dialog"
        aria-label="Carrinho"
        style={{
          position: "fixed",
          ...(isBottom
            ? { bottom: 0, left: 0, right: 0, maxHeight: "75vh", borderRadius: "20px 20px 0 0" }
            : { top: 0, right: 0, bottom: 0, width: "min(380px, 90vw)" }),
          zIndex: 9996,
          background: "var(--aacp-surface, #0f0f16)",
          borderLeft: isBottom ? undefined : "1px solid var(--aacp-line, rgba(255,255,255,0.1))",
          borderTop: isBottom ? "1px solid var(--aacp-line, rgba(255,255,255,0.1))" : undefined,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          animation: `${isBottom ? "ckui-sheet-up" : "ckui-drawer-right"} 0.28s cubic-bezier(0.22, 1, 0.36, 1) both`,
          boxShadow: "0 -8px 40px rgba(0,0,0,0.3)",
        }}
      >
        {/* Drag handle (bottom sheet only) */}
        {isBottom && (
          <div style={{ padding: "10px 0 4px", display: "flex", justifyContent: "center", cursor: "grab", touchAction: "none" }}>
            <div style={{ width: "38px", height: "4px", borderRadius: "4px", background: "var(--aacp-muted, #8b8b95)", opacity: 0.4 }} />
          </div>
        )}

        {/* Header — cart icon + badge + total + close */}
        <div style={{ padding: "12px 18px 14px", display: "flex", alignItems: "center", gap: "11px" }}>
          <span style={{ position: "relative", width: "34px", height: "34px", borderRadius: "10px", background: "color-mix(in srgb, var(--aacp-accent, #0f766e) 12%, transparent)", border: "1px solid var(--aacp-line, rgba(255,255,255,0.1))", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--aacp-accent, #0f766e)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 6h15l-1.5 9h-12z" />
              <path d="M6 6L5 3H2" />
              <circle cx="9" cy="20" r="1.4" />
              <circle cx="18" cy="20" r="1.4" />
            </svg>
            {cart.itemCount > 0 && (
              <span style={{ position: "absolute", top: "-4px", right: "-4px", minWidth: "16px", height: "16px", borderRadius: "8px", background: "var(--aacp-accent, #0f766e)", color: "#fff", fontSize: "9px", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", padding: "0 4px" }}>
                {cart.itemCount}
              </span>
            )}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--aacp-fg, #f5f5f7)" }}>Carrinho</span>
            </div>
            <div style={{ fontSize: "10.5px", color: "var(--aacp-muted, #8b8b95)", marginTop: "2px" }}>
              {cart.itemCount} {cart.itemCount === 1 ? "item" : "itens"}
            </div>
          </div>
          <div style={{ textAlign: "right", marginRight: "8px" }}>
            <div style={{ fontSize: "18px", fontWeight: 700, letterSpacing: "-0.3px", color: "var(--aacp-fg)" }}>{formatPrice(cart.total)}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar carrinho"
            style={{ width: "30px", height: "30px", borderRadius: "50%", border: "1px solid var(--aacp-line, rgba(255,255,255,0.1))", background: "transparent", color: "var(--aacp-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0 }}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Items list */}
        <div style={{ flex: 1, overflowY: "auto", padding: "4px 18px 20px" }}>
          {cart.items.length === 0 ? (
            <div style={{ textAlign: "center", padding: "40px 10px", color: "var(--aacp-muted)" }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--aacp-fg)" }}>Carrinho vazio</div>
              <div style={{ fontSize: "11.5px", marginTop: "4px" }}>Use a busca para escolher um produto.</div>
            </div>
          ) : (
            <>
              {cart.items.map((item) => (
                <div
                  key={item.variantId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    padding: "14px",
                    borderRadius: "14px",
                    background: "var(--aacp-surface-2, rgba(255,255,255,0.04))",
                    border: "1px solid var(--aacp-line, rgba(255,255,255,0.08))",
                    marginBottom: "10px",
                  }}
                >
                  {/* Product thumbnail placeholder */}
                  <div style={{ width: "46px", height: "46px", borderRadius: "10px", flexShrink: 0, background: "linear-gradient(135deg, var(--aacp-surface-2), var(--aacp-surface-3, rgba(255,255,255,0.08)))", border: "1px solid var(--aacp-line)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontSize: "18px", fontWeight: 700, color: "var(--aacp-accent)", opacity: 0.4 }}>
                      {item.productName.charAt(0).toUpperCase()}
                    </span>
                  </div>

                  {/* Product details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--aacp-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.productName}
                    </div>
                    <div style={{ fontSize: "10.5px", color: "var(--aacp-muted)", marginTop: "2px" }}>
                      {formatPrice(item.price)} un.
                    </div>
                  </div>

                  {/* Qty controls */}
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <button
                      type="button"
                      onClick={() => item.quantity <= 1 ? onRemoveItem(item.variantId) : onUpdateQty(item.variantId, item.quantity - 1)}
                      style={{ width: "24px", height: "24px", borderRadius: "7px", border: "1px solid var(--aacp-line)", background: "var(--aacp-surface-2, rgba(255,255,255,0.05))", color: "var(--aacp-fg)", fontSize: "14px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                    >
                      −
                    </button>
                    <span style={{ fontSize: "13px", fontWeight: 600, minWidth: "14px", textAlign: "center", color: "var(--aacp-fg)" }}>
                      {item.quantity}
                    </span>
                    <button
                      type="button"
                      onClick={() => onUpdateQty(item.variantId, item.quantity + 1)}
                      style={{ width: "24px", height: "24px", borderRadius: "7px", border: "1px solid var(--aacp-line)", background: "var(--aacp-surface-2, rgba(255,255,255,0.05))", color: "var(--aacp-fg)", fontSize: "14px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}

              {/* Summary rows */}
              <div style={{ borderTop: "1px solid var(--aacp-line)", paddingTop: "12px", marginTop: "8px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                  <span style={{ fontSize: "12px", color: "var(--aacp-muted)" }}>Subtotal</span>
                  <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--aacp-fg)", fontVariantNumeric: "tabular-nums" }}>{formatPrice(cart.subtotal)}</span>
                </div>
                {cart.discount > 0 && (
                  <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                    <span style={{ fontSize: "12px", color: "var(--aacp-success, #34d399)" }}>Desconto</span>
                    <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--aacp-success, #34d399)" }}>-{formatPrice(cart.discount)}</span>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "10px 0 0", borderTop: "1px solid var(--aacp-line)", marginTop: "6px" }}>
                  <span style={{ fontSize: "12.5px", color: "var(--aacp-muted)" }}>Total final</span>
                  <span style={{ fontSize: "22px", fontWeight: 700, letterSpacing: "-0.4px", color: "var(--aacp-fg)" }}>{formatPrice(cart.total)}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer CTAs */}
        {cart.items.length > 0 && (
          <div style={{ padding: "0 18px 20px", display: "flex", flexDirection: "column", gap: "8px" }}>
            <button
              type="button"
              onClick={onCheckout}
              style={{
                width: "100%",
                height: "48px",
                borderRadius: "12px",
                border: "none",
                background: "var(--aacp-accent, #0f766e)",
                color: "#fff",
                fontSize: "14px",
                fontWeight: 700,
                cursor: "pointer",
                fontFamily: "inherit",
                letterSpacing: "0.01em",
                boxShadow: "0 4px 16px color-mix(in srgb, var(--aacp-accent, #0f766e) 35%, transparent)",
                transition: "transform 0.15s ease, box-shadow 0.15s ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.transform = "translateY(-1px)"; e.currentTarget.style.boxShadow = "0 8px 24px color-mix(in srgb, var(--aacp-accent) 45%, transparent)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 4px 16px color-mix(in srgb, var(--aacp-accent) 35%, transparent)"; }}
            >
              Finalizar pedido
            </button>

            {onViewCart && (
              <button
                type="button"
                onClick={onViewCart}
                style={{
                  width: "100%",
                  height: "40px",
                  borderRadius: "10px",
                  border: "1px solid var(--aacp-line)",
                  background: "transparent",
                  color: "var(--aacp-muted)",
                  fontSize: "12px",
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "border-color 0.15s, color 0.15s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--aacp-accent)"; e.currentTarget.style.color = "var(--aacp-fg)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--aacp-line)"; e.currentTarget.style.color = "var(--aacp-muted)"; }}
              >
                Continuar comprando
              </button>
            )}
          </div>
        )}
      </div>
    </>
  );
}
