import React, { Component, type ErrorInfo, type ReactNode } from "react";
import { isAssetLoadError } from "../lib/deployment-recovery.js";

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

export class PageErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[PageErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      const assetLoadFailed = isAssetLoadError(this.state.error);
      return (
        <div className="panel" role="alert" style={{ textAlign: "center", padding: "var(--space-8)" }}>
          <p style={{ fontWeight: 600, marginBottom: "var(--space-2)" }}>Algo deu errado nesta página.</p>
          <p className="text-muted" style={{ marginBottom: "var(--space-4)", fontSize: "0.85rem" }}>
            {assetLoadFailed
              ? "Não foi possível carregar esta página. Recarregue para tentar novamente."
              : this.state.error.message.slice(0, 200)}
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              if (assetLoadFailed) {
                window.location.reload();
                return;
              }
              this.setState({ error: null });
              this.props.onReset?.();
            }}
          >
            {assetLoadFailed ? "Recarregar página" : "Tentar novamente"}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
