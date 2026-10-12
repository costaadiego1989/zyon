import React, { useEffect, useState } from "react";
import { CheckCircle2, AlertTriangle, Loader2, RefreshCw, ChevronDown, ChevronUp, X } from "lucide-react";
import { useImportProgress, type BackgroundImportJob } from "./ImportProgressProvider.js";
import { importErrorMessage } from "./import-feedback.js";

const STALE_AFTER_MS = 10 * 60 * 1000;

function isImportStale(job: BackgroundImportJob): boolean {
  return job.status === "processing" && Date.now() - job.startedAt > STALE_AFTER_MS;
}

export function ImportProgressBanner() {
  const { imports, dismissImport, refreshImport } = useImportProgress();
  const [, forceTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forceTick((v) => v + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  if (imports.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes aiImportSlide {
          from { transform: translateX(-8px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        @keyframes aiImportProgress {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
        @keyframes spinGlobal {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div
        role="region"
        aria-label="Importações em segundo plano"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 9000,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          width: 360,
          maxWidth: "calc(100vw - 32px)",
          pointerEvents: "none",
        }}
      >
        {imports.map((job) => (
          <BackgroundImportBannerCard
            key={job.jobId}
            job={job}
            onDismiss={dismissImport}
            onRefresh={refreshImport}
          />
        ))}
      </div>
    </>
  );
}

function BackgroundImportBannerCard({
  job,
  onDismiss,
  onRefresh,
}: {
  job: BackgroundImportJob;
  onDismiss: (jobId: string) => void;
  onRefresh: (jobId: string) => Promise<void>;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const stale = isImportStale(job);

  const completedJob = job.status === "completed" ? job.job : undefined;
  const failedJob = job.status === "failed" ? job.job : undefined;

  const successCount = completedJob?.successRows ?? job.successRows ?? 0;
  const failCount = completedJob?.failedRows ?? job.failedRows ?? 0;
  const totalCount = completedJob?.totalRows ?? job.totalRows ?? 0;
  const errors = completedJob?.errors ?? failedJob?.errors ?? job.errors ?? [];
  const erp = completedJob?.erpSummary;
  const hasErp = erp && Object.values(erp).some(count => count > 0);
  const showRefresh = (job.status === "processing" && stale) || (job.status === "completed" && hasErp);
  const showDetails = (job.status === "completed" || job.status === "failed") && errors.length > 0;

  const accent =
    job.status === "completed"
      ? { color: "var(--color-success)", bg: "var(--color-success-bg, rgba(34,197,94,0.08))", border: "var(--color-success, #22c55e)" }
      : job.status === "failed"
        ? { color: "var(--color-error)", bg: "var(--color-error-bg)", border: "var(--color-error)" }
        : stale
          ? { color: "var(--color-text-muted)", bg: "var(--surface-1)", border: "var(--color-border)" }
          : { color: "var(--color-brand)", bg: "var(--surface-1)", border: "var(--color-border)" };

  const Icon =
    job.status === "completed" ? CheckCircle2 :
    job.status === "failed" ? AlertTriangle :
    stale ? AlertTriangle : Loader2;

  const title =
    job.status === "completed"
      ? `Catálogo atualizado: ${job.fileName}`
      : job.status === "failed"
        ? `Falha na importação: ${job.fileName}`
        : stale
          ? `Ainda processando: ${job.fileName}`
          : `Processando ${job.fileName}`;

  const subtitle =
    job.status === "completed"
      ? `${successCount} de ${totalCount} produto${successCount !== 1 ? "s" : ""} importado${successCount !== 1 ? "s" : ""}${failCount > 0 ? ` • ${failCount} com falha` : ""}`
      : job.status === "failed"
        ? (job.reason ? importErrorMessage(job.reason) : "Não foi possível processar a planilha.")
        : stale
          ? "A análise está levando mais que o esperado. Você pode continuar usando o painel."
          : "A IA está analisando sua planilha em segundo plano.";

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        background: "var(--surface-2)",
        border: `1px solid ${accent.border}`,
        borderRadius: 12,
        padding: "12px 14px",
        animation: "aiImportSlide 0.2s ease-out",
        pointerEvents: "auto",
        boxShadow: "0 8px 24px rgba(0,0,0,0.28)",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <Icon
          size={18}
          style={{
            color: accent.color,
            flexShrink: 0,
            animation: job.status === "processing" && !stale ? "spinGlobal 1s linear infinite" : undefined,
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)", overflowWrap: "anywhere" }}>{title}</div>
          <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>{subtitle}</div>
        </div>
        <button
          type="button"
          onClick={() => onDismiss(job.jobId)}
          aria-label="Fechar"
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "var(--color-text-faint)",
            padding: 8,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            minWidth: 32,
            minHeight: 32,
          }}
        >
          <X size={14} />
        </button>
      </div>

      {(showRefresh || showDetails) && <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }}>
        {showRefresh && (
          <button
            type="button"
            onClick={() => void onRefresh(job.jobId)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 10px",
              minHeight: 40,
              borderRadius: 6,
              border: "1px solid var(--color-border)",
              background: "var(--surface-1)",
              font: "600 11.5px var(--font-sans)",
              color: "var(--color-text)",
              cursor: "pointer",
            }}
          >
            <RefreshCw size={12} /> Verificar
          </button>
        )}

        {showDetails && (
          <button
            type="button"
            onClick={() => setDetailsOpen((v) => !v)}
            aria-expanded={detailsOpen}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "6px 10px",
              minHeight: 40,
              borderRadius: 6,
              border: "1px solid var(--color-border)",
              background: "var(--surface-1)",
              font: "600 11.5px var(--font-sans)",
              color: "var(--color-text)",
              cursor: "pointer",
            }}
          >
            {detailsOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            Ver detalhes
          </button>
        )}

      </div>}

      {hasErp && erp ? <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
        <div>Estoque no ERP: {erp.completed} ajustes confirmados; {erp.queued + erp.running} aguardando confirmação.</div>
        {erp.blocked > 0 ? <div>{erp.blocked} ajustes bloqueados. Confira o vínculo do SKU, o depósito e a conexão do ERP.</div> : null}
        {erp.uncertain + erp.failed > 0 ? <div>{erp.uncertain + erp.failed} ajustes precisam de conferência no ERP antes de um novo envio.</div> : null}
        {erp.superseded > 0 ? <div>{erp.superseded} ajustes foram substituídos por uma importação posterior. Confira o resultado dessa importação.</div> : null}
      </div> : null}

      {job.status === "processing" && !stale && (
        <div style={{ position: "relative", height: 4, borderRadius: 4, background: "var(--surface-1)", overflow: "hidden" }}>
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "25%",
              height: "100%",
              background: "var(--color-brand)",
              animation: "aiImportProgress 1.4s linear infinite",
            }}
          />
        </div>
      )}

      {detailsOpen && errors.length > 0 && (
        <div style={{ maxHeight: 200, overflowY: "auto", border: "1px solid var(--color-border)", borderRadius: 8 }}>
          {errors.map((e, i) => (
            <div
              key={`${e.row}-${i}`}
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                padding: "6px 10px",
                borderBottom: i === errors.length - 1 ? "none" : "1px solid var(--color-border)",
                font: "12px var(--font-sans)",
                color: "var(--color-text-muted)",
              }}
            >
              <span style={{ font: "12px var(--font-mono)", color: "var(--color-text-faint)", minWidth: 56 }}>
                {e.row > 0 ? `Linha ${e.row}` : "Arquivo"}
              </span>
              {e.sku && (
                <span style={{ font: "12px var(--font-mono)", color: "var(--color-text-faint)", minWidth: 80, overflowWrap: "anywhere", maxWidth: "100%" }}>
                  {e.sku}
                </span>
              )}
              <span style={{ flex: "1 1 140px", overflowWrap: "anywhere" }}>{importErrorMessage(e.reason)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
