import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "../lib/error-reporter.js";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Top-level error boundary for the checkout widget.
 * Catches unhandled render errors and displays a recovery UI
 * instead of crashing the entire widget permanently.
 */
export class CheckoutErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[aacp] widget render crash", error, info.componentStack);
    reportError(error, info.componentStack?.slice(0, 100) ?? "ErrorBoundary");
  }

  private handleReload = (): void => {
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "14px",
            padding: "32px 24px",
            textAlign: "center",
            height: "100%",
            minHeight: "200px",
            fontFamily: "inherit",
            color: "var(--tx, #e4e4e7)",
            background: "var(--bg, #08080c)",
          }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.5 }}>
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <p style={{ fontSize: "14px", fontWeight: 600, margin: 0 }}>
            Erro inesperado no checkout
          </p>
          <p style={{ fontSize: "12px", color: "var(--mut, #71717a)", margin: 0, maxWidth: "260px" }}>
            Algo deu errado. Atualize a página para continuar sua compra.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: "13px",
              fontWeight: 600,
              color: "#fff",
              padding: "10px 20px",
              borderRadius: "10px",
              background: "var(--g1, #0f766e)",
            }}
          >
            Recarregar página
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
