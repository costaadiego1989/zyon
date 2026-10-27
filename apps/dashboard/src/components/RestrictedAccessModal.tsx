import React from "react";
import { useAccessModal } from "../lib/auth/access-modal-context.js";

export function RestrictedAccessModal() {
  const { open, requiredTab, close } = useAccessModal();
  const onBackRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (!open) return;
    onBackRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, close]);

  if (!open) return null;

  function handleBack() {
    close();
    window.history.back();
  }
  function handleHome() {
    close();
    window.location.hash = "overview";
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="access-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleBack();
      }}
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999,
      }}
    >
      <div
        style={{
          background: "var(--card)", color: "var(--ink)", maxWidth: 440, width: "90%",
          padding: 24, borderRadius: 12, border: "1px solid var(--border)",
        }}
      >
        <h2 id="access-modal-title" style={{ margin: "0 0 12px", font: "600 18px var(--sans)" }}>
          Acesso restrito
        </h2>
        <p style={{ margin: "0 0 20px", font: "14px var(--sans)", color: "var(--ink)" }}>
          Você não tem permissão para acessar esta página. Caso precise, fale com o administrador da sua conta.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button
            ref={onBackRef}
            type="button"
            onClick={handleBack}
            style={{
              padding: "10px 16px", borderRadius: 8, border: "1px solid var(--border)",
              background: "transparent", color: "var(--ink)", cursor: "pointer",
              font: "600 14px var(--sans)",
            }}
          >
            Voltar
          </button>
          <button
            type="button"
            onClick={handleHome}
            style={{
              padding: "10px 16px", borderRadius: 8, border: "none",
              background: "var(--accent)", color: "#0A0F0A", cursor: "pointer",
              font: "600 14px var(--sans)",
            }}
          >
            Ir para início
          </button>
        </div>
        {requiredTab && (
          <p style={{ marginTop: 16, font: "11px var(--mono)", color: "var(--muted)" }}>
            Página: #{requiredTab}
          </p>
        )}
      </div>
    </div>
  );
}
