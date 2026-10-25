import React, { useEffect } from "react";

export interface SaveFeedbackBannerProps {
  result: "success" | "error" | null;
  onDismiss: () => void;
  successMessage?: string;
  errorMessage?: string;
}

export function SaveFeedbackBanner({
  result,
  onDismiss,
  successMessage,
  errorMessage,
}: SaveFeedbackBannerProps): React.ReactElement | null {
  useEffect(() => {
    if (result === "success") {
      const t = setTimeout(onDismiss, 4000);
      return () => clearTimeout(t);
    }
  }, [result, onDismiss]);

  if (result === null) return null;

  if (result === "success") {
    return (
      <div className="panel-success" role="status" aria-live="polite">
        {successMessage ?? "Regras salvas com sucesso"}
      </div>
    );
  }

  return (
    <div className="panel panel-error" role="alert">
      <span>{errorMessage ?? "Erro ao salvar regras"}</span>
      <button type="button" className="btn-sm" onClick={onDismiss} aria-label="Fechar">
        ×
      </button>
    </div>
  );
}
