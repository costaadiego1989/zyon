import React from "react";
import { X, Download } from "lucide-react";
import { useCsvImport } from "./hooks/useCsvImport.js";
import { CsvFileDropzone } from "./components/CsvFileDropzone.js";
import { CsvPreviewTable } from "./components/CsvPreviewTable.js";
import { CsvProgressBar } from "./components/CsvProgressBar.js";
import { CsvErrorList } from "./components/CsvErrorList.js";
import type { CsvRow } from "./utils/csv-validation.js";

export interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (rows: CsvRow[]) => Promise<void>;
}

const TEMPLATE_HEADER = "name,sku,price,stock,weight_grams,length_cm,width_cm,height_cm,description,category";
const TEMPLATE_ROWS = [
  'Produto Exemplo 1,SKU-001,99.99,100,500,10,15,20,"Descrição do produto","Eletrônicos"',
  'Produto Exemplo 2,SKU-002,149.50,50,750,12,18,25,"Outro produto","Acessórios"',
];

function downloadTemplate() {
  const csv = [TEMPLATE_HEADER, ...TEMPLATE_ROWS].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `template-produtos-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
}

export function CsvImportModal({ isOpen, onClose, onImport }: CsvImportModalProps) {
  const {
    step,
    parsedRows,
    errors,
    importing,
    importError,
    handleFileSelect,
    goToPreview,
    goToConfirm,
    goBack,
    handleImportConfirm,
  } = useCsvImport();

  if (!isOpen) return null;

  const hasErrors = errors.length > 0;

  return (
    <div
      onClick={onClose}
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
          maxWidth: 700,
          maxHeight: "90vh",
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          animation: "slideInUp 0.2s ease-out",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px", borderBottom: "1px solid var(--color-border)" }}>
          <h2 style={{ font: "600 18px var(--font-serif)", color: "var(--color-text)", margin: 0 }}>
            {step === "upload" && "Importar Produtos"}
            {step === "preview" && "Revisar Dados"}
            {step === "confirm" && "Confirmar Importação"}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              fontSize: 20,
              cursor: "pointer",
              color: "var(--color-text-faint)",
              padding: 0,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: "24px", overflowY: "auto" }}>
          {step === "upload" && (
            <>
              <p style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)", marginBottom: 16 }}>
                Selecione ou arraste um arquivo CSV com os dados dos produtos. O arquivo deve incluir as colunas: <strong>name</strong>, <strong>sku</strong> e <strong>price</strong>.
              </p>

              <CsvFileDropzone onFileSelect={handleFileSelect} />

              <CsvErrorList errors={errors} maxToShow={5} />

              <button
                type="button"
                onClick={downloadTemplate}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  background: "var(--surface-1)",
                  font: "600 12.5px var(--font-sans)",
                  color: "var(--color-text)",
                  cursor: "pointer",
                  width: "100%",
                  justifyContent: "center",
                }}
              >
                <Download size={14} /> Baixar Template CSV
              </button>
            </>
          )}

          {step === "preview" && (
            <>
              <p style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)", marginBottom: 16 }}>
                {parsedRows.length} linha{parsedRows.length !== 1 ? "s" : ""} pronta{parsedRows.length !== 1 ? "s" : ""} para importação.
              </p>

              <CsvErrorList errors={errors} maxToShow={10} />

              <CsvPreviewTable rows={parsedRows} errors={errors} />
            </>
          )}

          {step === "confirm" && (
            <>
              <p style={{ font: "13px var(--font-sans)", color: "var(--color-text-muted)", marginBottom: 16 }}>
                Você está prestes a importar {parsedRows.length} produto{parsedRows.length !== 1 ? "s" : ""}. Esta ação não pode ser desfeita. Confirme para continuar.
              </p>

              {importError && (
                <div style={{ background: "var(--color-error-bg)", border: "1px solid var(--color-error)", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
                  <div style={{ font: "600 12px var(--font-sans)", color: "var(--color-error)" }}>
                    Erro durante importação:
                  </div>
                  <p style={{ font: "12px var(--font-sans)", color: "var(--color-error)", margin: "6px 0 0" }}>
                    {importError}
                  </p>
                </div>
              )}

              <CsvProgressBar isImporting={importing} rowCount={parsedRows.length} />
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", gap: 10, padding: "16px 24px", borderTop: "1px solid var(--color-border)" }}>
          {step === "upload" && (
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
          )}

          {step === "preview" && (
            <>
              <button
                type="button"
                onClick={goBack}
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
                Voltar
              </button>
              <button
                type="button"
                onClick={goToConfirm}
                disabled={hasErrors}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--color-brand-hover)",
                  background: "var(--color-brand-hover)",
                  font: "600 12.5px var(--font-sans)",
                  color: "white",
                  cursor: hasErrors ? "not-allowed" : "pointer",
                  opacity: hasErrors ? 0.6 : 1,
                }}
              >
                Próximo
              </button>
            </>
          )}

          {step === "confirm" && (
            <>
              <button
                type="button"
                onClick={goBack}
                disabled={importing}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--color-border)",
                  background: "var(--surface-1)",
                  font: "600 12.5px var(--font-sans)",
                  color: "var(--color-text)",
                  cursor: importing ? "not-allowed" : "pointer",
                  opacity: importing ? 0.6 : 1,
                }}
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => handleImportConfirm(onImport, onClose)}
                disabled={importing}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--color-brand-hover)",
                  background: "var(--color-brand-hover)",
                  font: "600 12.5px var(--font-sans)",
                  color: "white",
                  cursor: importing ? "not-allowed" : "pointer",
                  opacity: importing ? 0.6 : 1,
                }}
              >
                {importing ? "Importando..." : "Confirmar Importação"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Re-exports for backward compatibility
export type { CsvRow } from "./utils/csv-validation.js";
