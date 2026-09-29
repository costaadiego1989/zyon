import React, { useEffect, useRef, useState } from "react";
import { Upload, FileSpreadsheet, Loader2 } from "lucide-react";
import { Modal } from "../Modal.js";
import { Button } from "../Button.js";
import "../import-dialog.css";
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
  return "Não foi possível confirmar o envio. Consulte o andamento em Produtos antes de tentar novamente.";
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
      setFile(null);
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
    <Modal isOpen={isOpen} title="Importar planilha com IA" subtitle="Envie o arquivo e acompanhe o processamento em Produtos." presentation="center" size="md" onClose={() => { if (closeable) onClose(); }} footer={<>
      <Button variant="outline" disabled={inFlight} onClick={onClose}>Cancelar</Button>
      <Button variant="primary" disabled={!file || inFlight} loading={inFlight} onClick={() => void startImport()}><Upload size={16} /> {inFlight ? "Enviando…" : "Enviar e processar"}</Button>
    </>}>
      <div className="import-dialog">
          {(phase.kind === "idle") && (
            <>
              <p style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)", marginBottom: 16 }}>
                Envie uma planilha com nome, código (SKU), preço, estoque e variações, quando houver. A IA interpreta as colunas para importar os produtos. Depois do processamento, confira o resultado e as linhas com erro no catálogo.
              </p>

              <button type="button" className="import-dialog__dropzone"
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
                  width: "100%",
                }}
              >
                <FileSpreadsheet size={32} style={{ color: "var(--color-brand)", margin: "0 auto 12px" }} />
                <p style={{ font: "14px var(--font-sans)", color: "var(--color-text)", margin: "8px 0 4px" }}>
                  {file ? file.name : "Clique para selecionar ou arraste sua planilha aqui"}
                </p>
                <p style={{ font: "12px var(--font-sans)", color: "var(--color-text-faint)", margin: 0 }}>
                  Arquivos aceitos: {ACCEPTED_EXT_LABEL}
                </p>
              </button>

              <input
                ref={fileInputRef}
                aria-label="Selecionar planilha"
                type="file"
                accept=".csv,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                style={{ display: "none" }}
                onChange={(e) => { handleFileSelection(e.target.files?.[0] ?? null); e.target.value = ""; }}
              />

              {errorMsg && (
                <div role="alert" style={{ background: "var(--color-error-bg)", border: "1px solid var(--color-error)", borderRadius: 8, padding: "12px 14px" }}>
                  <div style={{ font: "600 12px var(--font-sans)", color: "var(--color-error)" }}>{errorMsg}</div>
                </div>
              )}
            </>
          )}

          {phase.kind === "uploading" && (
            <div role="status" style={{ padding: "32px 16px", textAlign: "center" }}>
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

    </Modal>
  );
}
