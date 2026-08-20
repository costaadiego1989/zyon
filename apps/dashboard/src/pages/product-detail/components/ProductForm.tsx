import React from "react";
import { Package, Download, Clock } from "lucide-react";
import { PrefixInput } from "../../../components/PrefixInput.js";
import type { ProductMetadata } from "../ProductDetailPage.js";

export interface ProductFormProps {
  name: string;
  onNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  productType: "physical" | "digital" | "service";
  onProductTypeChange: (v: "physical" | "digital" | "service") => void;
  metadata: ProductMetadata;
  onMetadataChange: (v: ProductMetadata) => void;
  categoryId: string;
  onCategoryIdChange: (v: string) => void;
  isActive: boolean;
  onIsActiveChange: (v: boolean) => void;
  isEditing: boolean;
  categories: Array<{ id: string; name: string }>;
  generatingDesc: boolean;
  onGenerateDescription: () => void;
  formErrors: Record<string, string>;
}

export function ProductForm(props: ProductFormProps) {
  const {
    name,
    onNameChange,
    description,
    onDescriptionChange,
    productType,
    onProductTypeChange,
    metadata,
    onMetadataChange,
    categoryId,
    onCategoryIdChange,
    isActive,
    onIsActiveChange,
    isEditing,
    categories,
    generatingDesc,
    onGenerateDescription,
    formErrors,
  } = props;

  return (
    <>
      {/* PRODUCT TYPE SELECTOR */}
      <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
        <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>TIPO DE PRODUTO</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {(["physical", "digital", "service"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onProductTypeChange(type)}
              style={{
                padding: "14px 16px",
                borderRadius: 10,
                border: `2px solid ${productType === type ? "var(--accent-dark)" : "var(--border)"}`,
                background: productType === type ? "var(--accent-soft)" : "var(--bg)",
                color: productType === type ? "var(--accent-dark)" : "var(--ink)",
                cursor: "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                transition: "all 0.15s",
                textAlign: "center",
              }}
            >
              {type === "physical" && <Package size={18} />}
              {type === "digital" && <Download size={18} />}
              {type === "service" && <Clock size={18} />}
              <span style={{ font: "600 11px var(--sans)" }}>
                {type === "physical" && "Físico"}
                {type === "digital" && "Digital"}
                {type === "service" && "Serviço"}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* INFORMAÇÕES BÁSICAS */}
      <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
        <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>INFORMAÇÕES BÁSICAS</h3>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ font: "600 12px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Nome *</span>
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Ex: Camiseta preta M"
            style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${formErrors["name"] ? "var(--danger)" : "var(--border)"}`, font: "13px var(--sans)", color: "var(--ink)", outline: "none", background: "var(--bg)" }}
          />
          {formErrors["name"] ? (
            <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{formErrors["name"]}</span>
          ) : null}
        </label>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ font: "600 12px var(--sans)", color: "var(--ink)" }}>Descrição</span>
            <button
              type="button"
              disabled={generatingDesc}
              onClick={onGenerateDescription}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 6, border: generatingDesc ? "1px solid var(--accent-dark)" : "1px solid var(--accent-line)", background: generatingDesc ? "var(--accent-dark)" : "var(--accent-soft)", color: generatingDesc ? "#fff" : "var(--accent-dark)", font: "600 11px var(--sans)", cursor: generatingDesc ? "not-allowed" : "pointer" }}
            >
              {generatingDesc ? (
                <>
                  <div style={{ width: 10, height: 10, border: "1.5px solid #fff", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.7s linear infinite", flex: "none" }} />
                  Gerando...
                </>
              ) : (
                <>✦ Gerar com IA</>
              )}
            </button>
          </div>
          <textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            rows={4}
            placeholder={name.trim() ? "Descreva o produto ou clique em 'Gerar com IA'..." : "Preencha o nome do produto primeiro para gerar com IA"}
            style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", font: "13px var(--sans)", color: "var(--ink)", outline: "none", background: "var(--bg)", resize: "vertical" }}
          />
        </div>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ font: "600 12px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Categoria</span>
          {categories.length > 0 ? (
            <select
              value={categoryId}
              onChange={(e) => onCategoryIdChange(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", font: "13px var(--sans)", color: "var(--ink)", outline: "none", background: "var(--bg)" }}
            >
              <option value="">Sem categoria</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          ) : (
            <input
              value={categoryId}
              onChange={(e) => onCategoryIdChange(e.target.value)}
              placeholder="Ex: cat_abc123"
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", font: "13px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--bg)" }}
            />
          )}
        </label>
        {isEditing && (
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <span style={{ font: "600 12px var(--sans)", color: "var(--ink)" }}>Ativo</span>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => onIsActiveChange(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: "var(--accent-dark)", cursor: "pointer" }}
            />
            <span style={{ font: "12px var(--sans)", color: "var(--faint)" }}>{isActive ? "Sim" : "Não"}</span>
          </label>
        )}
      </section>

      {/* DIGITAL-ONLY FIELDS */}
      {productType === "digital" && (
        <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
          <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>INFORMAÇÕES DO DOWNLOAD</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
            <Field label="URL de Download" value={metadata.downloadUrl ?? ""} onChange={(val) => onMetadataChange({ ...metadata, downloadUrl: val })} placeholder="https://example.com/download/arquivo" />
            <Field label="Tamanho do arquivo" value={metadata.fileSize ?? ""} onChange={(val) => onMetadataChange({ ...metadata, fileSize: val })} placeholder="Ex: 15.5 MB, 320 KB" />
            <Field label="Formato" value={metadata.fileFormat ?? ""} onChange={(val) => onMetadataChange({ ...metadata, fileFormat: val })} placeholder="Ex: PDF, ZIP, MP3" />
          </div>
        </section>
      )}

      {/* SERVICE-ONLY FIELDS */}
      {productType === "service" && (
        <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
          <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>AGENDAMENTO DO SERVIÇO</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
            <label style={{ display: "block" }}>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Modalidade *</span>
              <select
                value={metadata.serviceType ?? ""}
                onChange={(e) => onMetadataChange({ ...metadata, serviceType: e.target.value as "presencial" | "remoto" })}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12.5px var(--sans)", color: "var(--ink)", outline: "none", background: "var(--card)", cursor: "pointer" }}
              >
                <option value="">Selecione</option>
                <option value="presencial">Presencial</option>
                <option value="remoto">Remoto</option>
              </select>
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
              <DateTimeField label="Data Inicial" type="date" value={metadata.startDate ?? ""} onChange={(val) => onMetadataChange({ ...metadata, startDate: val })} />
              <DateTimeField label="Hora Inicial" type="time" value={metadata.startTime ?? ""} onChange={(val) => onMetadataChange({ ...metadata, startTime: val })} />
              <DateTimeField label="Data Final" type="date" value={metadata.endDate ?? ""} onChange={(val) => onMetadataChange({ ...metadata, endDate: val })} />
              <DateTimeField label="Hora Final" type="time" value={metadata.endTime ?? ""} onChange={(val) => onMetadataChange({ ...metadata, endTime: val })} />
            </div>
            {metadata.serviceType === "remoto" && (
              <label style={{ display: "block" }}>
                <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Link da reunião</span>
                <input
                  value={metadata.remoteLink ?? ""}
                  onChange={(e) => onMetadataChange({ ...metadata, remoteLink: e.target.value })}
                  placeholder="https://zoom.us/j/... ou https://meet.google.com/..."
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12.5px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--card)" }}
                />
                <span style={{ font: "10px var(--sans)", color: "var(--faint)", marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
                  <a href="https://meet.google.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-dark)", textDecoration: "none" }}>Google Meet</a>
                  <span style={{ color: "var(--border)" }}>|</span>
                  <a href="https://zoom.us" target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent-dark)", textDecoration: "none" }}>Zoom</a>
                  <span style={{ color: "var(--border)" }}>|</span>
                  <span>Em breve: integração automática</span>
                </span>
              </label>
            )}
            <label style={{ display: "block" }}>
              <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Observações</span>
              <textarea
                value={metadata.notes ?? ""}
                onChange={(e) => onMetadataChange({ ...metadata, notes: e.target.value })}
                rows={3}
                placeholder="Ex: Trazer documento XYZ, Material disponível em PDF..."
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12.5px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--card)", resize: "vertical" }}
              />
            </label>
          </div>
        </section>
      )}
    </>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; error?: string; placeholder?: string }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>{props.label}</span>
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${props.error ? "var(--danger)" : "var(--border)"}`, font: "12.5px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--card)" }}
      />
      {props.error ? (
        <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{props.error}</span>
      ) : null}
    </label>
  );
}

function DateTimeField(props: { label: string; type: "date" | "time"; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>{props.label}</span>
      <input
        type={props.type}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12.5px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--card)" }}
      />
    </label>
  );
}
