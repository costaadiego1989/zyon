import React, { ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { reportError } from "../lib/observability/error-reporter.js";

/**
 * PageErrorBoundary — full-page error boundary.
 * Renders a full-page error state with retry button.
 * Used as the root error boundary for entire pages.
 */
export class PageErrorBoundary extends React.Component<
  { children: ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): { error: Error | null } {
    return { error };
  }

  componentDidCatch(error: Error) {
    reportError({
      source: "PageErrorBoundary",
      error,
      severity: "error",
    });
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "100vh",
            padding: 24,
            background: "var(--background)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 16,
              maxWidth: 400,
            }}
          >
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: 12,
                background: "var(--danger-soft)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <AlertTriangle size={32} strokeWidth={1.75} color="var(--danger)" />
            </div>
            <h1 style={{ font: "600 18px var(--sans)", margin: 0, textAlign: "center" }}>
              Algo deu errado
            </h1>
            <p
              style={{
                font: "13px var(--sans)",
                color: "var(--muted)",
                margin: 0,
                textAlign: "center",
                lineHeight: 1.5,
              }}
            >
              Desculpe, encontramos um erro inesperado. Por favor, tente recarregar a página.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "10px 16px",
                borderRadius: 6,
                border: "1px solid var(--border)",
                background: "var(--card)",
                font: "500 13px var(--sans)",
                color: "var(--text)",
                cursor: "pointer",
              }}
            >
              <RotateCcw size={14} strokeWidth={2} />
              Recarregar página
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * SectionErrorBoundary — section-level error boundary.
 * Renders a compact error state with retry button.
 * Wraps individual sections within pages to isolate errors.
 */
export class SectionErrorBoundary extends React.Component<
  { children: ReactNode; sectionName?: string },
  { error: Error | null; key: number }
> {
  constructor(props: { children: ReactNode; sectionName?: string }) {
    super(props);
    this.state = { error: null, key: 0 };
  }

  static getDerivedStateFromError(error: Error): { error: Error | null } {
    return { error };
  }

  componentDidCatch(error: Error) {
    reportError({
      source: "SectionErrorBoundary",
      error,
      context: { sectionName: this.props.sectionName },
      severity: "error",
    });
  }

  handleRetry = () => {
    this.setState((prev) => ({ error: null, key: prev.key + 1 }));
  };

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 16,
            borderRadius: 8,
            border: "1px solid var(--danger-soft)",
            background: "var(--danger-soft)",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 6,
              background: "var(--danger)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <AlertTriangle size={18} strokeWidth={2} color="white" />
          </div>
          <div style={{ flex: 1 }}>
            <p
              style={{
                font: "500 13px var(--sans)",
                color: "var(--danger)",
                margin: "0 0 4px 0",
              }}
            >
              Algo deu errado
            </p>
            <p
              style={{
                font: "12px var(--sans)",
                color: "var(--danger)",
                margin: 0,
                opacity: 0.8,
              }}
            >
              {this.props.sectionName ? `Erro em "${this.props.sectionName}"` : "Erro ao carregar esta seção"}
            </p>
          </div>
          <button
            type="button"
            onClick={this.handleRetry}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 4,
              border: "none",
              background: "var(--danger)",
              color: "white",
              font: "500 12px var(--sans)",
              cursor: "pointer",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            <RotateCcw size={12} strokeWidth={2} />
            Tentar novamente
          </button>
        </div>
      );
    }

    return <React.Fragment key={this.state.key}>{this.props.children}</React.Fragment>;
  }
}
