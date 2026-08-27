"use client";

import { useState } from "react";

export interface SettingsTabProps {
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onExportData: () => Promise<void>;
  onDeleteAccount: () => Promise<void>;
  onLogout: () => void;
  exportLoading?: boolean;
  deleteLoading?: boolean;
}

export function SettingsTab({
  theme,
  onToggleTheme,
  onExportData,
  onDeleteAccount,
  onLogout,
  exportLoading = false,
  deleteLoading = false,
}: SettingsTabProps) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleExport = async () => {
    setExportError(null);
    try {
      await onExportData();
    } catch (err) {
      setExportError(err instanceof Error ? err.message : "Erro ao exportar dados");
    }
  };

  const handleDelete = async () => {
    setDeleteError(null);
    try {
      await onDeleteAccount();
      setShowDeleteConfirm(false);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Erro ao deletar conta");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", paddingBottom: "16px" }}>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .settings-spinner {
          animation: spin 1s linear infinite;
        }
      `}</style>

      {/* Appearance */}
      <div>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--aacp-muted)",
            textTransform: "uppercase",
            marginBottom: "8px",
          }}
        >
          Aparência
        </div>
        <button
          onClick={onToggleTheme}
          aria-label={`Alternar para modo ${theme === "dark" ? "claro" : "escuro"}`}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: "8px",
            border: "1px solid var(--aacp-line)",
            background: "var(--aacp-card)",
            color: "var(--aacp-fg)",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            gap: "8px",
            justifyContent: "center",
            transition: "background 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--aacp-surface-3)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "var(--aacp-card)";
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {theme === "dark" ? (
              <>
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </>
            ) : (
              <>
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </>
            )}
          </svg>
          {theme === "dark" ? "☀️ Modo claro" : "🌙 Modo escuro"}
        </button>
      </div>

      {/* LGPD Data Export */}
      <div style={{ paddingTop: "8px", borderTop: "1px solid var(--aacp-line)" }}>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "var(--aacp-muted)",
            textTransform: "uppercase",
            marginBottom: "8px",
          }}
        >
          Privacidade (LGPD)
        </div>
        <button
          onClick={handleExport}
          disabled={exportLoading}
          aria-label="Exportar meus dados (LGPD)"
          aria-busy={exportLoading}
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: "8px",
            border: "1px solid var(--aacp-line)",
            background: exportLoading ? "var(--aacp-surface-2)" : "var(--aacp-card)",
            color: "var(--aacp-fg)",
            cursor: exportLoading ? "not-allowed" : "pointer",
            fontSize: "13px",
            fontWeight: 500,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            opacity: exportLoading ? 0.6 : 1,
            transition: "opacity 0.15s ease",
          }}
          onMouseEnter={(e) => {
            if (!exportLoading) {
              e.currentTarget.style.background = "var(--aacp-surface-3)";
            }
          }}
          onMouseLeave={(e) => {
            if (!exportLoading) {
              e.currentTarget.style.background = "var(--aacp-card)";
            }
          }}
        >
          {exportLoading ? (
            <>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="settings-spinner"
              >
                <circle cx="12" cy="12" r="10" />
              </svg>
              Exportando...
            </>
          ) : (
            <>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Exportar meus dados
            </>
          )}
        </button>
        {exportError && (
          <div
            role="alert"
            style={{
              marginTop: "6px",
              fontSize: "11px",
              color: "#ef4444",
              padding: "6px 8px",
              borderRadius: "4px",
              background: "color-mix(in srgb, #ef4444 10%, transparent)",
            }}
          >
            {exportError}
          </div>
        )}
      </div>

      {/* Danger Zone: Delete Account */}
      <div style={{ paddingTop: "8px", borderTop: "1px solid var(--aacp-line)" }}>
        <div
          style={{
            fontSize: "11px",
            fontWeight: 600,
            color: "#ef4444",
            textTransform: "uppercase",
            marginBottom: "8px",
          }}
        >
          Zona de perigo
        </div>
        {!showDeleteConfirm ? (
          <button
            onClick={() => setShowDeleteConfirm(true)}
            aria-label="Excluir minha conta"
            style={{
              width: "100%",
              padding: "10px 12px",
              borderRadius: "8px",
              border: "1px solid #ef4444",
              background: "transparent",
              color: "#ef4444",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              transition: "background 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "color-mix(in srgb, #ef4444 8%, transparent)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <line x1="10" y1="11" x2="10" y2="17" />
              <line x1="14" y1="11" x2="14" y2="17" />
            </svg>
            Excluir minha conta
          </button>
        ) : (
          <div
            style={{
              padding: "12px",
              borderRadius: "8px",
              border: "1px solid #ef4444",
              background: "color-mix(in srgb, #ef4444 5%, transparent)",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
            }}
          >
            <div
              style={{
                fontSize: "12px",
                color: "var(--aacp-fg)",
                fontWeight: 500,
                lineHeight: 1.5,
              }}
            >
              Tem certeza? Esta ação é <strong>irreversível</strong>.
            </div>
            {deleteError && (
              <div
                role="alert"
                style={{
                  fontSize: "11px",
                  color: "#ef4444",
                  padding: "6px 8px",
                  borderRadius: "4px",
                  background: "color-mix(in srgb, #ef4444 10%, transparent)",
                }}
              >
                {deleteError}
              </div>
            )}
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => {
                  setShowDeleteConfirm(false);
                  setDeleteError(null);
                }}
                disabled={deleteLoading}
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: "6px",
                  border: "1px solid var(--aacp-line)",
                  background: "var(--aacp-card)",
                  color: "var(--aacp-fg)",
                  cursor: deleteLoading ? "not-allowed" : "pointer",
                  fontSize: "12px",
                  fontWeight: 600,
                  opacity: deleteLoading ? 0.5 : 1,
                }}
                aria-label="Cancelar exclusão"
              >
                Cancelar
              </button>
              <button
                onClick={handleDelete}
                disabled={deleteLoading}
                aria-label="Confirmar exclusão de conta"
                aria-busy={deleteLoading}
                style={{
                  flex: 1,
                  padding: "8px",
                  borderRadius: "6px",
                  border: "1px solid #ef4444",
                  background: "#ef4444",
                  color: "#fff",
                  cursor: deleteLoading ? "not-allowed" : "pointer",
                  fontSize: "12px",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                  opacity: deleteLoading ? 0.7 : 1,
                }}
              >
                {deleteLoading ? (
                  <>
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="settings-spinner"
                    >
                      <circle cx="12" cy="12" r="10" />
                    </svg>
                    Deletando...
                  </>
                ) : (
                  "Deletar"
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Logout */}
      <div style={{ paddingTop: "8px", borderTop: "1px solid var(--aacp-line)" }}>
        <button
          onClick={onLogout}
          aria-label="Sair da conta"
          style={{
            width: "100%",
            padding: "10px 12px",
            borderRadius: "8px",
            border: "1px solid #ef4444",
            background: "transparent",
            color: "#ef4444",
            cursor: "pointer",
            fontSize: "13px",
            fontWeight: 600,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            transition: "background 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "color-mix(in srgb, #ef4444 8%, transparent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          Sair da conta
        </button>
      </div>
    </div>
  );
}
