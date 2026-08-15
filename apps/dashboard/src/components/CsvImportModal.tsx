import React, { useState, useRef } from "react";
import { Upload, Download, X, AlertCircle } from "lucide-react";

export interface CsvRow {
  name: string;
  sku: string;
  price: number;
  stock?: number;
  weight_grams?: number;
  length_cm?: number;
  width_cm?: number;
  height_cm?: number;
  description?: string;
  category?: string;
}

export interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (rows: CsvRow[]) => Promise<void>;
}

type ModalStep = "upload" | "preview" | "confirm";

interface ValidationError {
  rowIndex: number;
  field: string;
  message: string;
}

export function CsvImportModal({ isOpen, onClose, onImport }: CsvImportModalProps) {
  const [step, setStep] = useState<ModalStep>("upload");
  const [parsedRows, setParsedRows] = useState<CsvRow[]>([]);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

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

  function parseAndValidateCsv(text: string): { rows: CsvRow[]; errors: ValidationError[] } {
    const lines = text.split("\n").filter((l) => l.trim());
    const csvRows: CsvRow[] = [];
    const validationErrors: ValidationError[] = [];

    if (lines.length < 2) {
      validationErrors.push({
        rowIndex: 0,
        field: "file",
        message: "CSV vazio ou sem dados. Mínimo de 1 linha de dados requerida.",
      });
      return { rows: [], errors: validationErrors };
    }

    // Parse header
    const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
    const nameIdx = header.indexOf("name");
    const skuIdx = header.indexOf("sku");
    const priceIdx = header.indexOf("price");
    const stockIdx = header.indexOf("stock");
    const weightIdx = header.indexOf("weight_grams");
    const lengthIdx = header.indexOf("length_cm");
    const widthIdx = header.indexOf("width_cm");
    const heightIdx = header.indexOf("height_cm");
    const descIdx = header.indexOf("description");
    const categoryIdx = header.indexOf("category");

    if (nameIdx === -1 || skuIdx === -1 || priceIdx === -1) {
      validationErrors.push({
        rowIndex: 0,
        field: "header",
        message: "CSV deve conter as colunas obrigatórias: name, sku, price",
      });
      return { rows: [], errors: validationErrors };
    }

    // Parse data rows
    for (let i = 1; i < lines.length; i++) {
      const rowIndex = i - 1;
      // Simple CSV parsing: split by comma, but don't handle quoted values with commas yet
      const cols = lines[i]!.split(",").map((c) => c.trim().replace(/^"|"$/g, ""));

      const name = cols[nameIdx]?.trim();
      const sku = cols[skuIdx]?.trim();
      const priceStr = cols[priceIdx]?.trim();
      const stockStr = cols[stockIdx]?.trim();
      const weightStr = cols[weightIdx]?.trim();
      const lengthStr = cols[lengthIdx]?.trim();
      const widthStr = cols[widthIdx]?.trim();
      const heightStr = cols[heightIdx]?.trim();
      const description = cols[descIdx]?.trim();
      const category = cols[categoryIdx]?.trim();

      // Validate required fields
      if (!name) {
        validationErrors.push({
          rowIndex,
          field: "name",
          message: "Nome é obrigatório",
        });
      }

      if (!sku) {
        validationErrors.push({
          rowIndex,
          field: "sku",
          message: "SKU é obrigatório",
        });
      }

      if (!priceStr) {
        validationErrors.push({
          rowIndex,
          field: "price",
          message: "Preço é obrigatório",
        });
      } else {
        const price = parseFloat(priceStr);
        if (isNaN(price) || price < 0) {
          validationErrors.push({
            rowIndex,
            field: "price",
            message: "Preço deve ser um número válido >= 0",
          });
        }
      }

      // Validate optional numeric fields
      if (stockStr) {
        const stock = parseInt(stockStr, 10);
        if (isNaN(stock) || stock < 0) {
          validationErrors.push({
            rowIndex,
            field: "stock",
            message: "Estoque deve ser um número inteiro >= 0",
          });
        }
      }

      if (weightStr) {
        const weight = parseFloat(weightStr);
        if (isNaN(weight) || weight < 0) {
          validationErrors.push({
            rowIndex,
            field: "weight_grams",
            message: "Peso deve ser um número válido >= 0",
          });
        }
      }

      if (lengthStr) {
        const length = parseFloat(lengthStr);
        if (isNaN(length) || length < 0) {
          validationErrors.push({
            rowIndex,
            field: "length_cm",
            message: "Comprimento deve ser um número válido >= 0",
          });
        }
      }

      if (widthStr) {
        const width = parseFloat(widthStr);
        if (isNaN(width) || width < 0) {
          validationErrors.push({
            rowIndex,
            field: "width_cm",
            message: "Largura deve ser um número válido >= 0",
          });
        }
      }

      if (heightStr) {
        const height = parseFloat(heightStr);
        if (isNaN(height) || height < 0) {
          validationErrors.push({
            rowIndex,
            field: "height_cm",
            message: "Altura deve ser um número válido >= 0",
          });
        }
      }

      // If no validation errors for this row, add it to parsed rows
      const rowHasErrors = validationErrors.some((e) => e.rowIndex === rowIndex);
      if (!rowHasErrors && name && sku && priceStr) {
        csvRows.push({
          name,
          sku,
          price: parseFloat(priceStr),
          stock: stockStr ? parseInt(stockStr, 10) : undefined,
          weight_grams: weightStr ? parseFloat(weightStr) : undefined,
          length_cm: lengthStr ? parseFloat(lengthStr) : undefined,
          width_cm: widthStr ? parseFloat(widthStr) : undefined,
          height_cm: heightStr ? parseFloat(heightStr) : undefined,
          description: description || undefined,
          category: category || undefined,
        });
      }
    }

    return { rows: csvRows, errors: validationErrors };
  }

  function handleFileSelect(file: File | null) {
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      setErrors([{ rowIndex: 0, field: "file", message: "Apenas arquivos .csv são suportados" }]);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const { rows, errors: validationErrors } = parseAndValidateCsv(text);
      setErrors(validationErrors);
      setParsedRows(rows);
      setImportError(null);

      if (validationErrors.length === 0 && rows.length > 0) {
        setStep("preview");
      }
    };
    reader.onerror = () => {
      setErrors([{ rowIndex: 0, field: "file", message: "Erro ao ler arquivo" }]);
    };
    reader.readAsText(file);
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current?.setAttribute("data-drag-over", "true");
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current?.removeAttribute("data-drag-over");
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current?.removeAttribute("data-drag-over");

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  }

  async function handleImportConfirm() {
    if (parsedRows.length === 0) return;

    setImporting(true);
    setImportError(null);

    try {
      await onImport(parsedRows);
      setStep("upload");
      setParsedRows([]);
      setErrors([]);
      onClose();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  const hasErrors = errors.length > 0;
  const errorsByRow = new Map<number, ValidationError[]>();
  errors.forEach((err) => {
    if (!errorsByRow.has(err.rowIndex)) {
      errorsByRow.set(err.rowIndex, []);
    }
    errorsByRow.get(err.rowIndex)!.push(err);
  });

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
          background: "var(--card)",
          border: "1px solid var(--border)",
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px", borderBottom: "1px solid var(--border)" }}>
          <h2 style={{ font: "600 18px var(--serif)", color: "var(--ink)", margin: 0 }}>
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
              color: "var(--faint)",
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
              <p style={{ font: "13px var(--sans)", color: "var(--muted)", marginBottom: 16 }}>
                Selecione ou arraste um arquivo CSV com os dados dos produtos. O arquivo deve incluir as colunas: <strong>name</strong>, <strong>sku</strong> e <strong>price</strong>.
              </p>

              {/* Drop zone */}
              <div
                ref={dropZoneRef}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: "2px dashed var(--border)",
                  borderRadius: 10,
                  padding: "40px 24px",
                  textAlign: "center",
                  cursor: "pointer",
                  background: "var(--bg)",
                  transition: "all 0.2s",
                  opacity: dropZoneRef.current?.getAttribute("data-drag-over") === "true" ? 1 : 0.6,
                  borderColor: dropZoneRef.current?.getAttribute("data-drag-over") === "true" ? "var(--accent-dark)" : "var(--border)",
                  marginBottom: 16,
                }}
              >
                <Upload size={32} style={{ color: "var(--accent-dark)", marginBottom: 12, margin: "0 auto" }} />
                <p style={{ font: "14px var(--sans)", color: "var(--ink)", margin: "8px 0 4px" }}>
                  Clique para selecionar ou arraste um arquivo aqui
                </p>
                <p style={{ font: "12px var(--sans)", color: "var(--faint)", margin: 0 }}>
                  Arquivo .csv apenas
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                style={{ display: "none" }}
                onChange={(e) => handleFileSelect(e.target.files?.[0] ?? null)}
              />

              {hasErrors && (
                <div style={{ background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                    <AlertCircle size={16} style={{ color: "var(--danger)", flexShrink: 0, marginTop: 2 }} />
                    <div>
                      <div style={{ font: "600 12px var(--sans)", color: "var(--danger)", marginBottom: 6 }}>
                        Erros encontrados:
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 16, font: "12px var(--sans)", color: "var(--danger)" }}>
                        {errors.slice(0, 5).map((err, idx) => (
                          <li key={idx}>
                            Linha {err.rowIndex + 1}, coluna <strong>{err.field}</strong>: {err.message}
                          </li>
                        ))}
                        {errors.length > 5 && <li>... e {errors.length - 5} erros adicionais</li>}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {/* Template button */}
              <button
                type="button"
                onClick={downloadTemplate}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  font: "600 12.5px var(--sans)",
                  color: "var(--ink)",
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
              <p style={{ font: "13px var(--sans)", color: "var(--muted)", marginBottom: 16 }}>
                {parsedRows.length} linha{parsedRows.length !== 1 ? "s" : ""} pronta{parsedRows.length !== 1 ? "s" : ""} para importação.
              </p>

              {/* Validation errors */}
              {errors.length > 0 && (
                <div style={{ background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
                  <div style={{ font: "600 12px var(--sans)", color: "var(--danger)", marginBottom: 8 }}>
                    Aviso: {errors.length} erro{errors.length !== 1 ? "s" : ""} encontrado{errors.length !== 1 ? "s" : ""}
                  </div>
                  <ul style={{ margin: 0, paddingLeft: 16, font: "12px var(--sans)", color: "var(--danger)" }}>
                    {errors.slice(0, 10).map((err, idx) => (
                      <li key={idx}>
                        Linha {err.rowIndex + 1}: {err.field} - {err.message}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Preview table */}
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", font: "12px var(--mono)" }}>
                  <thead>
                    <tr style={{ background: "var(--bg)", borderBottom: "1px solid var(--border)" }}>
                      <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--faint)", fontWeight: 600 }}>Nome</th>
                      <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--faint)", fontWeight: 600 }}>SKU</th>
                      <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--faint)", fontWeight: 600 }}>Preço</th>
                      <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--faint)", fontWeight: 600 }}>Estoque</th>
                      <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--faint)", fontWeight: 600 }}>Peso</th>
                      <th style={{ textAlign: "left", padding: "8px 12px", color: "var(--faint)", fontWeight: 600 }}>Descrição</th>
                    </tr>
                  </thead>
                  <tbody>
                    {parsedRows.map((row, idx) => (
                      <tr
                        key={idx}
                        style={{
                          borderBottom: "1px solid var(--border)",
                          background: errorsByRow.has(idx) ? "var(--danger-soft)" : "transparent",
                        }}
                      >
                        <td style={{ padding: "8px 12px", color: "var(--ink)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.name}
                        </td>
                        <td style={{ padding: "8px 12px", color: "var(--muted)", maxWidth: 80, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.sku}
                        </td>
                        <td style={{ padding: "8px 12px", color: "var(--muted)" }}>{row.price.toFixed(2)}</td>
                        <td style={{ padding: "8px 12px", color: "var(--muted)" }}>{row.stock ?? "-"}</td>
                        <td style={{ padding: "8px 12px", color: "var(--muted)" }}>{row.weight_grams ? `${row.weight_grams}g` : "-"}</td>
                        <td style={{ padding: "8px 12px", color: "var(--muted)", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {row.description ?? "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {step === "confirm" && (
            <>
              <p style={{ font: "13px var(--sans)", color: "var(--muted)", marginBottom: 16 }}>
                Você está prestes a importar {parsedRows.length} produto{parsedRows.length !== 1 ? "s" : ""}. Esta ação não pode ser desfeita. Confirme para continuar.
              </p>

              {importError && (
                <div style={{ background: "var(--danger-soft)", border: "1px solid var(--danger)", borderRadius: 8, padding: "12px 14px", marginBottom: 16 }}>
                  <div style={{ font: "600 12px var(--sans)", color: "var(--danger)" }}>
                    Erro durante importação:
                  </div>
                  <p style={{ font: "12px var(--sans)", color: "var(--danger)", margin: "6px 0 0" }}>
                    {importError}
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", gap: 10, padding: "16px 24px", borderTop: "1px solid var(--border)" }}>
          {step === "upload" && (
            <>
              <button
                type="button"
                onClick={onClose}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  font: "600 12.5px var(--sans)",
                  color: "var(--ink)",
                  cursor: "pointer",
                }}
              >
                Cancelar
              </button>
            </>
          )}

          {step === "preview" && (
            <>
              <button
                type="button"
                onClick={() => {
                  setStep("upload");
                  setParsedRows([]);
                  setErrors([]);
                }}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  font: "600 12.5px var(--sans)",
                  color: "var(--ink)",
                  cursor: "pointer",
                }}
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={() => setStep("confirm")}
                disabled={hasErrors && errors.length > 0}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--accent-dark)",
                  background: "var(--accent-dark)",
                  font: "600 12.5px var(--sans)",
                  color: "white",
                  cursor: hasErrors && errors.length > 0 ? "not-allowed" : "pointer",
                  opacity: hasErrors && errors.length > 0 ? 0.6 : 1,
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
                onClick={() => setStep("preview")}
                disabled={importing}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--border)",
                  background: "var(--bg)",
                  font: "600 12.5px var(--sans)",
                  color: "var(--ink)",
                  cursor: importing ? "not-allowed" : "pointer",
                  opacity: importing ? 0.6 : 1,
                }}
              >
                Voltar
              </button>
              <button
                type="button"
                onClick={handleImportConfirm}
                disabled={importing}
                style={{
                  flex: 1,
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "1px solid var(--accent-dark)",
                  background: "var(--accent-dark)",
                  font: "600 12.5px var(--sans)",
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
