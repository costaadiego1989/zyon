import React, { useEffect, useRef, useState } from "react";
import { X, Upload, FileSpreadsheet, AlertTriangle, Loader2 } from "lucide-react";
import { useCatalogApi } from "../../hooks/api/useCatalogApi.js";

export interface AiSpreadsheetImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  merchantId: string;
  /** Fired after the upload succeeds and we have a jobId. Modal closes immediately. */
  onImportStarted: (jobId: string, fileName: string) => void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" };

const ACCEPTED_MIMES = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
];
const ACCEPTED_EXT_LABEL = ".csv, .xls, .xlsx";

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Falha ao ler arquivo"));
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Resultado inesperado do FileReader"));
        return;
      }
      const commaIdx = result.indexOf(",");
      if (commaIdx === -1) {
        resolve(result);
        return;
      }
      resolve(result.slice(commaIdx + 1));
    };
    reader.readAsDataURL(file);
  });
}

function classifyError(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

export function AiSpreadsheetImportModal({ isOpen, onClose, merchantId, onImportStarted }: AiSpreadsheetImportModalProps) {
  const catalog = useCatalogApi();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setFile(null);
    setPhase({ kind: "idle" });
    setErrorMsg(null);
  }, [isOpen]);

  if (!isOpen) return null;

  const closeable = phase.kind === "idle";

  function handleFileSelection(selected: File | null) {
    if (!selected) {
      setFile(null);
      return;
    }
    const okByMime = ACCEPTED_MIMES.includes(selected.type);
    const okByExt = /\.(csv|xls|xlsx)$/i.test(selected.name);
    if (!okByMime && !okByExt) {
      setErrorMsg(`Formato não suportado. Aceitos: ${ACCEPTED_EXT_LABEL}`);
      return;
    }
    setErrorMsg(null);
    setFile(selected);
  }

  async function startImport() {
    if (!file) return;
    setErrorMsg(null);
    setPhase({ kind: "uploading" });
    try {
      const base64 = await readFileAsBase64(file);
      const result = await catalog.uploadSpreadsheetImport(merchantId, {
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        base64,
      });
      // Upload accepted — hand off to the page and close. Polling lives in the VM hook.
      const jobId = result.jobId;
      const fileName = file.name;
      setFile(null);
      setPhase({ kind: "idle" });
      setErrorMsg(null);
      onImportStarted(jobId, fileName);
      onClose();
    } catch (err) {
      setErrorMsg(classifyError(err));
      setPhase({ kind: "idle" });
    }
  }

  const inFlight = phase.kind === "uploading";

  return (
    <div
      onClick={closeable ? onClose : undefined}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(2px)",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "relative",
          background: "var(--surface-2)",
          border: "1px solid var(--color-border)",
          borderRadius: 14,
          width: "90vw",
          maxWidth: 640,
          maxHeight: "90vh",
          display: "flex",
          flexDirection: "column",
          animation: "slideInUp 0.2s ease-out",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px", borderBottom: "1px solid var(--color-border)" }}>
          <div>
            <div style={{ font: "600 10px var(--font-mono)", letterSpacing: "0.06em", color: "var(--color-brand)", textTransform: "uppercase", marginBottom: 6 }}>
              Growth+
            </div>
            <h2 style={{ font: "600 18px var(--font-serif)", color: "var(--color-text)", margin: 0 }}>
              Importar planilha com IA
            </h2>
          </div>
          <button
            type="button"
            onClick={closeable ? onClose : undefined}
            disabled={!closeable}
            aria-label="Fechar"
            style={{
              background: "none",
              border: "none",
              fontSize: 20,
              cursor: closeable ? "pointer" : "not-allowed",
              color: "var(--color-text-faint)",
              padding: 0,
              opacity: closeable ? 1 : 0.5,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: "24px", overflowY: "auto" }}>
          {(phase.kind === "idle") && (
            <>
              <p style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)", marginBottom: 16 }}>
                A IA ajusta sua planilha automaticamente. Envie no seu formato — reconhecemos colunas como nome, SKU, preço, estoque e variações automaticamente. Nenhum template necessário.
              </p>

              <div
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleFileSelection(e.dataTransfer.files?.[0] ?? null);
                }}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: "2px dashed var(--color-border)",
                  borderRadius: 10,
                  padding: "40px 24px",
                  textAlign: "center",
                  cursor: "pointer",
                  background: "var(--surface-1)",
                  marginBottom: 16,
                  transition: "all 0.2s",
                }}
              >
                <FileSpreadsheet size={32} style={{ color: "var(--color-brand)", margin: "0 auto 12px" }} />
                <p style={{ font: "14px var(--font-sans)", color: "var(--color-text)", margin: "8px 0 4px" }}>
                  {file ? file.name : "Clique para selecionar ou arraste sua planilha aqui"}
                </p>
                <p style={{ font: "12px var(--font-sans)", color: "var(--color-text-faint)", margin: 0 }}>
                  Arquivos aceitos: {ACCEPTED_EXT_LABEL}
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                style={{ display: "none" }}
                onChange={(e) => handleFileSelection(e.target.files?.[0] ?? null)}
              />

              {errorMsg && (
                <div style={{ background: "var(--color-error-bg)", border: "1px solid var(--color-error)", borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ font: "600 12px var(--font-sans)", color: "var(--color-error)" }}>{errorMsg}</div>
                </div>
              )}
            </>
          )}

          {phase.kind === "uploading" && (
            <div style={{ padding: "32px 16px", textAlign: "center" }}>
              <Loader2 size={36} style={{ color: "var(--color-brand)", margin: "0 auto 16px", animation: "spin 1s linear infinite" }} />
              <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)", marginBottom: 6 }}>
                Enviando planilha...
              </div>
              <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-faint)" }}>
                Aguarde enquanto o arquivo é preparado. O processamento continua em segundo plano após o envio.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", gap: 10, padding: "16px 24px", borderTop: "1px solid var(--color-border)" }}>
          {phase.kind === "idle" && (
            <>
              <button
                type="button"
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  background: "var(--surface-1)",
                  font: "600 12.5px var(--font-sans)",
                  color: "var(--color-text)",
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void startImport()}
                disabled={!file}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--color-brand-hover)",
                  background: "var(--color-brand-hover)",
                  font: "600 12.5px var(--font-sans)",
                  color: "white",
                  cursor: file ? "pointer" : "not-allowed",
                  opacity: file ? 1 : 0.6,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                }}
              >
                <Upload size={14} /> Enviar e processar
              </button>
            </>
          )}
        </div>

        <style>{`
          @keyframes slideInUp {
            from { transform: translateY(12px); opacity: 0; }
            to { transform: translateY(0); opacity: 1; }
          }
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  );
}
