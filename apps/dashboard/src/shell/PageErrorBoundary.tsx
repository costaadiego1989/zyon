import React, { Component, type ErrorInfo, type ReactNode } from "react";

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
      return (
        <div className="panel" style={{ textAlign: "center", padding: "var(--space-8)" }}>
          <p style={{ fontWeight: 600, marginBottom: "var(--space-2)" }}>Algo deu errado nesta página.</p>
          <p className="text-muted" style={{ marginBottom: "var(--space-4)", fontSize: "0.85rem" }}>
            {this.state.error.message.slice(0, 200)}
          </p>
          <button
            type="button"
            className="btn-primary"
            onClick={() => {
              this.setState({ error: null });
              this.props.onReset?.();
            }}
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
