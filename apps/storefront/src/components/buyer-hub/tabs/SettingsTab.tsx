"use client";

import { useState } from "react";
import { FiSun, FiMoon, FiDownload, FiTrash2, FiLogOut, FiLoader } from "react-icons/fi";

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

      {}
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
          {theme === "dark" ? (
            <>
              <FiSun size={14} aria-hidden="true" />
              Modo claro
            </>
          ) : (
            <>
              <FiMoon size={14} aria-hidden="true" />
              Modo escuro
            </>
          )}
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
              <FiLoader size={14} aria-hidden="true" className="settings-spinner" />
              Exportando...
            </>
          ) : (
            <>
              <FiDownload size={14} aria-hidden="true" />
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
            <FiTrash2 size={14} aria-hidden="true" />
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
                    <FiLoader size={12} aria-hidden="true" className="settings-spinner" />
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
          <FiLogOut size={14} aria-hidden="true" />
          Sair da conta
        </button>
      </div>
    </div>
  );
}
