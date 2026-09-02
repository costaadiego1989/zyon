import React, { useEffect, useRef, useState } from "react";
import { X, Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { useCatalogApi } from "../../hooks/api/useCatalogApi.js";
import type { ImportJobStatus } from "../../api/endpoints/catalog.js";

export interface AiSpreadsheetImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  merchantId: string;
  onImported?: () => void;
}

type Phase =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "polling"; jobId: string }
  | { kind: "completed"; job: ImportJobStatus }
  | { kind: "failed"; job: ImportJobStatus; reason: string };

const ACCEPTED_MIMES = [
  "text/csv",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/octet-stream",
];
const ACCEPTED_EXT_LABEL = ".csv, .xls, .xlsx";
const POLL_INTERVAL_MS = 1500;
const MAX_POLLS = 40;

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

export function AiSpreadsheetImportModal({ isOpen, onClose, merchantId, onImported }: AiSpreadsheetImportModalProps) {
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

  // Polling loop
  useEffect(() => {
    if (phase.kind !== "polling") return;
    const jobId = phase.jobId;
    let cancelled = false;
    let attempts = 0;

    void (async () => {
      while (!cancelled && attempts < MAX_POLLS) {
        attempts += 1;
        try {
          const job = await catalog.getImportJob(merchantId, jobId);
          if (cancelled) return;
          if (job.status === "completed") {
            setPhase({ kind: "completed", job });
            return;
          }
          if (job.status === "failed") {
            const first = job.errors?.[0]?.reason ?? "Falha ao processar planilha";
            setPhase({ kind: "failed", job, reason: first });
            return;
          }
        } catch (err) {
          if (cancelled) return;
          setErrorMsg(classifyError(err));
          setPhase({ kind: "idle" });
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      }
      if (!cancelled) {
        setErrorMsg("Tempo limite excedido. Tente novamente em alguns minutos.");
        setPhase({ kind: "idle" });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [phase, catalog, merchantId]);

  if (!isOpen) return null;

  const closeable = phase.kind === "idle" || phase.kind === "completed" || phase.kind === "failed";

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
      setPhase({ kind: "polling", jobId: result.jobId });
    } catch (err) {
      setErrorMsg(classifyError(err));
      setPhase({ kind: "idle" });
    }
  }

  function handleConclude() {
    if (phase.kind === "completed") {
      onImported?.();
    }
    onClose();
  }

  const inFlight = phase.kind === "uploading" || phase.kind === "polling";

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

          {(phase.kind === "uploading" || phase.kind === "polling") && (
            <div style={{ padding: "32px 16px", textAlign: "center" }}>
              <Loader2 size={36} style={{ color: "var(--color-brand)", margin: "0 auto 16px", animation: "spin 1s linear infinite" }} />
              <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)", marginBottom: 6 }}>
                {phase.kind === "uploading" ? "Enviando planilha..." : "IA analisando sua planilha"}
              </div>
              <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-faint)" }}>
                {phase.kind === "polling" ? "Isso pode levar alguns segundos." : "Aguarde enquanto o arquivo é preparado."}
              </div>
            </div>
          )}

          {phase.kind === "completed" && (
            <CompletedSummary job={phase.job} />
          )}

          {phase.kind === "failed" && (
            <FailedSummary reason={phase.reason} errors={phase.job.errors} />
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

          {phase.kind === "completed" && (
            <button
              type="button"
              onClick={handleConclude}
              style={{
                flex: 1,
                padding: "10px 14px",
                borderRadius: 8,
                border: "1px solid var(--color-brand-hover)",
                background: "var(--color-brand-hover)",
                font: "600 12.5px var(--font-sans)",
                color: "white",
                cursor: "pointer",
              }}
            >
              Concluir
            </button>
          )}

          {phase.kind === "failed" && (
            <>
              <button
                type="button"
                onClick={() => {
                  setErrorMsg(null);
                  setPhase({ kind: "idle" });
                  setFile(null);
                }}
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
                Tentar novamente
              </button>
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
                Fechar
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

function CompletedSummary({ job }: { job: ImportJobStatus }) {
  const total = job.totalRows ?? 0;
  const success = job.successRows ?? 0;
  const failed = job.failedRows ?? 0;
  const errors = job.errors ?? [];
  const mapping = job.columnMapping ?? {};

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--color-success-bg, rgba(34,197,94,0.08))",
          border: "1px solid var(--color-success, #22c55e)",
          borderRadius: 10,
          padding: "14px 16px",
          marginBottom: 16,
        }}
      >
        <CheckCircle2 size={20} style={{ color: "var(--color-success, #22c55e)" }} />
        <div>
          <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>
            Importação concluída
          </div>
          <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
            {success} de {total} produto{success !== 1 ? "s" : ""} importado{success !== 1 ? "s" : ""}{failed > 0 ? ` • ${failed} com erro` : ""}
          </div>
        </div>
      </div>

      {Object.keys(mapping).length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ font: "600 11px var(--font-mono)", letterSpacing: "0.05em", color: "var(--color-text-faint)", textTransform: "uppercase", marginBottom: 8 }}>
            Mapeamento detectado
          </div>
          <div style={{ background: "var(--surface-1)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "10px 12px" }}>
            {Object.entries(mapping).map(([src, dst]) => (
              <div key={src} style={{ display: "flex", justifyContent: "space-between", font: "12px var(--font-mono)", color: "var(--color-text-muted)", padding: "3px 0" }}>
                <span>{src}</span>
                <span style={{ color: "var(--color-text-faint)" }}>→ {dst}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div>
          <div style={{ font: "600 11px var(--font-mono)", letterSpacing: "0.05em", color: "var(--color-text-faint)", textTransform: "uppercase", marginBottom: 8 }}>
            Erros por linha ({errors.length})
          </div>
          <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 8 }}>
            {errors.map((e, i) => (
              <div
                key={`${e.row}-${i}`}
                style={{
                  display: "flex",
                  gap: 12,
                  padding: "8px 12px",
                  borderBottom: i === errors.length - 1 ? "none" : "1px solid var(--color-border)",
                  font: "12px var(--font-sans)",
                  color: "var(--color-text-muted)",
                }}
              >
                <span style={{ font: "12px var(--font-mono)", color: "var(--color-text-faint)", minWidth: 56 }}>
                  Linha {e.row}
                </span>
                {e.sku && (
                  <span style={{ font: "12px var(--font-mono)", color: "var(--color-text-faint)", minWidth: 80 }}>
                    {e.sku}
                  </span>
                )}
                <span style={{ flex: 1 }}>{e.reason}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function FailedSummary({ reason, errors }: { reason: string; errors?: ImportJobStatus["errors"] }) {
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--color-error-bg)",
          border: "1px solid var(--color-error)",
          borderRadius: 10,
          padding: "14px 16px",
          marginBottom: 16,
        }}
      >
        <AlertTriangle size={20} style={{ color: "var(--color-error)" }} />
        <div>
          <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-error)" }}>
            Não foi possível processar a planilha
          </div>
          <div style={{ font: "12px var(--font-sans)", color: "var(--color-error)", marginTop: 4 }}>
            {reason}
          </div>
        </div>
      </div>

      {errors && errors.length > 0 && (
        <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 8 }}>
          {errors.map((e, i) => (
            <div
              key={`${e.row}-${i}`}
              style={{
                display: "flex",
                gap: 12,
                padding: "8px 12px",
                borderBottom: i === errors.length - 1 ? "none" : "1px solid var(--color-border)",
                font: "12px var(--font-sans)",
                color: "var(--color-text-muted)",
              }}
            >
              <span style={{ font: "12px var(--font-mono)", color: "var(--color-text-faint)", minWidth: 56 }}>
                Linha {e.row}
              </span>
              <span style={{ flex: 1 }}>{e.reason}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
