"use client";

import { Component, useRef, type ReactNode } from "react";
import { useModalFocus } from "@zyon/checkout-ui";

type Props = {
  children: ReactNode;
  onClose: () => void;
  onRetry: () => void;
};

export default class CheckoutErrorBoundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return <CheckoutFailure onClose={this.props.onClose} onRetry={this.props.onRetry} />;
  }
}

function CheckoutFailure({ onClose, onRetry }: Pick<Props, "onClose" | "onRetry">) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(true, dialogRef, onClose);

  return (
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Checkout" tabIndex={-1} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "var(--aacp-bg, #f7f8fa)", color: "var(--aacp-fg, #111827)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, padding: 24, textAlign: "center" }}>
        <div role="alert">
          <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>Não foi possível abrir o checkout</h2>
          <p style={{ margin: 0 }}>Seu carrinho foi mantido. Tente novamente ou volte à loja.</p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 12 }}>
          <button data-neu="primary" type="button" onClick={onRetry} style={{ padding: "12px 20px", background: "var(--aacp-accent, #0f766e)", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", font: "inherit" }}>
            Tentar novamente
          </button>
          <button data-neu="control" type="button" onClick={onClose} style={{ padding: "12px 20px", background: "var(--aacp-surface, #ffffff)", color: "inherit", border: "1px solid var(--aacp-border-color, #e5e7eb)", borderRadius: 8, cursor: "pointer", font: "inherit" }}>
            Voltar à loja
          </button>
        </div>
      </div>
    );
}
