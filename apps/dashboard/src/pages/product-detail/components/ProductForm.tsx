import React from "react";
import { Package, Download, Clock, Utensils, Plus, Trash2 } from "lucide-react";
import { PrefixInput } from "../../../components/PrefixInput.js";
import type { ProductMetadata } from "../ProductDetailPage.js";
import type { FoodOptionGroupDraft } from "../hooks/useProductForm.js";
import { MAX_OPTION_GROUPS, MAX_ITEMS_PER_GROUP, emptyFoodOptionGroup, emptyFoodOptionItem } from "../hooks/useProductForm.js";

export interface ProductFormProps {
  name: string;
  onNameChange: (v: string) => void;
  description: string;
  onDescriptionChange: (v: string) => void;
  productType: "physical" | "digital" | "service" | "food";
  onProductTypeChange: (v: "physical" | "digital" | "service" | "food") => void;
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
  optionGroups: FoodOptionGroupDraft[];
  onOptionGroupsChange: (v: FoodOptionGroupDraft[]) => void;
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    optionGroups,
    onOptionGroupsChange,
  } = props;

  return (
    <>
      {/* PRODUCT TYPE SELECTOR */}
      <section style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: "20px 22px" }}>
        <h3 style={{ font: "600 12px var(--font-mono)", color: "var(--color-text-faint)", letterSpacing: "0.05em", marginBottom: 14 }}>TIPO DE PRODUTO</h3>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {(["physical", "digital", "service", "food"] as const).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => onProductTypeChange(type)}
              style={{
                padding: "14px 16px",
                borderRadius: 10,
                border: `2px solid ${productType === type ? "var(--color-brand-hover)" : "var(--color-border)"}`,
                background: productType === type ? "var(--color-brand-subtle)" : "var(--surface-1)",
                color: productType === type ? "var(--color-brand-hover)" : "var(--color-text)",
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
              {type === "food" && <Utensils size={18} />}
              <span style={{ font: "600 11px var(--font-sans)" }}>
                {type === "physical" && "Físico"}
                {type === "digital" && "Digital"}
                {type === "service" && "Serviço"}
                {type === "food" && "Alimentação"}
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* INFORMAÇÕES BÁSICAS */}
      <section style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: "20px 22px" }}>
        <h3 style={{ font: "600 12px var(--font-mono)", color: "var(--color-text-faint)", letterSpacing: "0.05em", marginBottom: 14 }}>INFORMAÇÕES BÁSICAS</h3>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ font: "600 12px var(--font-sans)", color: "var(--color-text)", display: "block", marginBottom: 4 }}>Nome *</span>
          <input
            value={name}
            onChange={(e) => onNameChange(e.target.value)}
            placeholder="Ex: Camiseta preta M"
            style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${formErrors["name"] ? "var(--color-error)" : "var(--color-border)"}`, font: "13px var(--font-sans)", color: "var(--color-text)", outline: "none", background: "var(--surface-1)" }}
          />
          {formErrors["name"] ? (
            <span style={{ font: "11px var(--font-sans)", color: "var(--color-error)", marginTop: 4, display: "block" }}>{formErrors["name"]}</span>
          ) : null}
        </label>
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <span style={{ font: "600 12px var(--font-sans)", color: "var(--color-text)" }}>Descrição</span>
            <button
              type="button"
              disabled={generatingDesc}
              onClick={onGenerateDescription}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "5px 12px", borderRadius: 6, border: generatingDesc ? "1px solid var(--color-brand-hover)" : "1px solid var(--color-brand-ring)", background: generatingDesc ? "var(--color-brand-hover)" : "var(--color-brand-subtle)", color: generatingDesc ? "#fff" : "var(--color-brand-hover)", font: "600 11px var(--font-sans)", cursor: generatingDesc ? "not-allowed" : "pointer" }}
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
            style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--color-border)", font: "13px var(--font-sans)", color: "var(--color-text)", outline: "none", background: "var(--surface-1)", resize: "vertical" }}
          />
        </div>
        <label style={{ display: "block", marginBottom: 12 }}>
          <span style={{ font: "600 12px var(--font-sans)", color: "var(--color-text)", display: "block", marginBottom: 4 }}>Categoria</span>
          {categories.length > 0 ? (
            <select
              value={categoryId}
              onChange={(e) => onCategoryIdChange(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--color-border)", font: "13px var(--font-sans)", color: "var(--color-text)", outline: "none", background: "var(--surface-1)" }}
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
              style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--color-border)", font: "13px var(--font-mono)", color: "var(--color-text)", outline: "none", background: "var(--surface-1)" }}
            />
          )}
        </label>
        {isEditing && (
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
            <span style={{ font: "600 12px var(--font-sans)", color: "var(--color-text)" }}>Ativo</span>
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => onIsActiveChange(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: "var(--color-brand-hover)", cursor: "pointer" }}
            />
            <span style={{ font: "12px var(--font-sans)", color: "var(--color-text-faint)" }}>{isActive ? "Sim" : "Não"}</span>
          </label>
        )}
      </section>

      {/* DIGITAL-ONLY FIELDS */}
      {productType === "digital" && (
        <section style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: "20px 22px" }}>
          <h3 style={{ font: "600 12px var(--font-mono)", color: "var(--color-text-faint)", letterSpacing: "0.05em", marginBottom: 14 }}>INFORMAÇÕES DO DOWNLOAD</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 12 }}>
            <Field label="URL de Download" value={metadata.downloadUrl ?? ""} onChange={(val) => onMetadataChange({ ...metadata, downloadUrl: val })} placeholder="https://example.com/download/arquivo" />
            <Field label="Tamanho do arquivo" value={metadata.fileSize ?? ""} onChange={(val) => onMetadataChange({ ...metadata, fileSize: val })} placeholder="Ex: 15.5 MB, 320 KB" />
            <Field label="Formato" value={metadata.fileFormat ?? ""} onChange={(val) => onMetadataChange({ ...metadata, fileFormat: val })} placeholder="Ex: PDF, ZIP, MP3" />
          </div>
        </section>
      )}

      {/* SERVICE-ONLY FIELDS */}
      {productType === "service" && (
        <section style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: "20px 22px" }}>
          <h3 style={{ font: "600 12px var(--font-mono)", color: "var(--color-text-faint)", letterSpacing: "0.05em", marginBottom: 14 }}>AGENDAMENTO DO SERVIÇO</h3>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
            <label style={{ display: "block" }}>
              <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "block", marginBottom: 4 }}>Modalidade *</span>
              <select
                value={metadata.serviceType ?? ""}
                onChange={(e) => onMetadataChange({ ...metadata, serviceType: e.target.value as "presencial" | "remoto" })}
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--color-border)", font: "12.5px var(--font-sans)", color: "var(--color-text)", outline: "none", background: "var(--surface-2)", cursor: "pointer" }}
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
                <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "block", marginBottom: 4 }}>Link da reunião</span>
                <input
                  value={metadata.remoteLink ?? ""}
                  onChange={(e) => onMetadataChange({ ...metadata, remoteLink: e.target.value })}
                  placeholder="https://zoom.us/j/... ou https://meet.google.com/..."
                  style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--color-border)", font: "12.5px var(--font-mono)", color: "var(--color-text)", outline: "none", background: "var(--surface-2)" }}
                />
                <span style={{ font: "10px var(--font-sans)", color: "var(--color-text-faint)", marginTop: 6, display: "flex", gap: 8, alignItems: "center" }}>
                  <a href="https://meet.google.com" target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-brand-hover)", textDecoration: "none" }}>Google Meet</a>
                  <span style={{ color: "var(--color-border)" }}>|</span>
                  <a href="https://zoom.us" target="_blank" rel="noopener noreferrer" style={{ color: "var(--color-brand-hover)", textDecoration: "none" }}>Zoom</a>
                  <span style={{ color: "var(--color-border)" }}>|</span>
                  <span>Em breve: integração automática</span>
                </span>
              </label>
            )}
            <label style={{ display: "block" }}>
              <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "block", marginBottom: 4 }}>Observações</span>
              <textarea
                value={metadata.notes ?? ""}
                onChange={(e) => onMetadataChange({ ...metadata, notes: e.target.value })}
                rows={3}
                placeholder="Ex: Trazer documento XYZ, Material disponível em PDF..."
                style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--color-border)", font: "12.5px var(--font-mono)", color: "var(--color-text)", outline: "none", background: "var(--surface-2)", resize: "vertical" }}
              />
            </label>
          </div>
        </section>
      )}

      {/* FOOD-ONLY FIELDS */}
      {productType === "food" && (
        <section style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: "20px 22px" }}>
          <h3 style={{ font: "600 12px var(--font-mono)", color: "var(--color-text-faint)", letterSpacing: "0.05em", marginBottom: 14 }}>VARIAÇÕES DO PRODUTO</h3>
          <p style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginBottom: 14 }}>
            Crie categorias de variações (ex: Bordas, Recheio). Cada categoria tem itens com acréscimo opcional. Limite: {MAX_OPTION_GROUPS} categorias, {MAX_ITEMS_PER_GROUP} itens por categoria.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {optionGroups.map((group, gIdx) => (
              <div key={group.id} style={{ border: "1px solid var(--color-border)", borderRadius: 10, padding: 14, background: "var(--surface-1)" }}>
                <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 10, alignItems: "end", marginBottom: 10 }}>
                  <label style={{ display: "block" }}>
                    <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "block", marginBottom: 4 }}>Nome da categoria *</span>
                    <input
                      value={group.name}
                      onChange={(e) => {
                        const next = [...optionGroups];
                        next[gIdx] = { ...group, name: e.target.value };
                        onOptionGroupsChange(next);
                      }}
                      placeholder="Ex: Bordas, Recheio, Massa"
                      style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--color-border)", font: "12.5px var(--font-mono)", color: "var(--color-text)", outline: "none", background: "var(--surface-2)" }}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "block", marginBottom: 4 }}>Seleção</span>
                    <select
                      value={group.selectionType}
                      onChange={(e) => {
                        const next = [...optionGroups];
                        next[gIdx] = { ...group, selectionType: e.target.value as "single" | "multiple" };
                        onOptionGroupsChange(next);
                      }}
                      style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--color-border)", font: "12.5px var(--font-sans)", color: "var(--color-text)", outline: "none", background: "var(--surface-2)", cursor: "pointer" }}
                    >
                      <option value="single">Única</option>
                      <option value="multiple">Múltipla</option>
                    </select>
                  </label>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, paddingBottom: 6, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={group.required}
                      onChange={(e) => {
                        const next = [...optionGroups];
                        next[gIdx] = { ...group, required: e.target.checked };
                        onOptionGroupsChange(next);
                      }}
                      style={{ width: 16, height: 16, accentColor: "var(--color-brand-hover)", cursor: "pointer" }}
                    />
                    <span style={{ font: "12px var(--font-sans)", color: "var(--color-text)" }}>Obrigatório</span>
                  </label>
                  <button
                    type="button"
                    aria-label={`Remover categoria ${group.name || gIdx + 1}`}
                    onClick={() => onOptionGroupsChange(optionGroups.filter((_, i) => i !== gIdx))}
                    style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--color-error)", background: "var(--color-error-bg)", color: "var(--color-error)", cursor: "pointer", display: "inline-flex", alignItems: "center" }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {group.items.map((item, iIdx) => (
                    <div key={item.id} style={{ display: "grid", gridTemplateColumns: "1fr 140px auto", gap: 8, alignItems: "center" }}>
                      <input
                        value={item.name}
                        onChange={(e) => {
                          const next = [...optionGroups];
                          const items = [...group.items];
                          items[iIdx] = { ...item, name: e.target.value };
                          next[gIdx] = { ...group, items };
                          onOptionGroupsChange(next);
                        }}
                        placeholder="Ex: Calabresa, Mussarela"
                        style={{ width: "100%", padding: "6px 10px", borderRadius: 6, border: "1px solid var(--color-border)", font: "12.5px var(--font-mono)", color: "var(--color-text)", outline: "none", background: "var(--surface-2)" }}
                      />
                      <PrefixInput
                        prefix="R$"
                        inputMode="decimal"
                        value={item.priceModifierInCents === 0 ? "" : formatCents(item.priceModifierInCents)}
                        onChange={(v) => {
                          const numeric = Number(v.replace(/[^\d,]/g, "").replace(",", ".")) || 0;
                          const cents = Math.round(numeric * 100);
                          const next = [...optionGroups];
                          const items = [...group.items];
                          items[iIdx] = { ...item, priceModifierInCents: Math.max(0, cents) };
                          next[gIdx] = { ...group, items };
                          onOptionGroupsChange(next);
                        }}
                        placeholder="0,00"
                      />
                      <button
                        type="button"
                        aria-label={`Remover item ${item.name || iIdx + 1}`}
                        disabled={group.items.length <= 1}
                        onClick={() => {
                          const next = [...optionGroups];
                          const items = group.items.filter((_, i) => i !== iIdx);
                          next[gIdx] = { ...group, items };
                          onOptionGroupsChange(next);
                        }}
                        style={{ padding: "6px 8px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--surface-2)", color: group.items.length <= 1 ? "var(--color-text-faint)" : "var(--color-error)", cursor: group.items.length <= 1 ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", opacity: group.items.length <= 1 ? 0.5 : 1 }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  ))}
                </div>

                <button
                  type="button"
                  disabled={group.items.length >= MAX_ITEMS_PER_GROUP}
                  onClick={() => {
                    const next = [...optionGroups];
                    next[gIdx] = { ...group, items: [...group.items, emptyFoodOptionItem()] };
                    onOptionGroupsChange(next);
                  }}
                  style={{ marginTop: 8, display: "inline-flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 6, border: "1px solid var(--color-brand-ring)", background: "var(--color-brand-subtle)", color: "var(--color-brand-hover)", font: "600 11px var(--font-sans)", cursor: group.items.length >= MAX_ITEMS_PER_GROUP ? "not-allowed" : "pointer", opacity: group.items.length >= MAX_ITEMS_PER_GROUP ? 0.5 : 1 }}
                >
                  <Plus size={12} /> Adicionar item
                </button>
              </div>
            ))}

            <button
              type="button"
              disabled={optionGroups.length >= MAX_OPTION_GROUPS}
              onClick={() => onOptionGroupsChange([...optionGroups, emptyFoodOptionGroup()])}
              style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--color-brand-ring)", background: "var(--color-brand-subtle)", color: "var(--color-brand-hover)", font: "600 12px var(--font-sans)", cursor: optionGroups.length >= MAX_OPTION_GROUPS ? "not-allowed" : "pointer", opacity: optionGroups.length >= MAX_OPTION_GROUPS ? 0.5 : 1, alignSelf: "flex-start" }}
            >
              <Plus size={14} /> Nova categoria ({optionGroups.length}/{MAX_OPTION_GROUPS})
            </button>

            {optionGroups.length > 0 && (
              <div style={{ padding: "12px 14px", borderRadius: 10, background: "var(--color-brand-subtle)", border: "1px solid var(--color-brand-ring)", marginTop: 4 }}>
                <div style={{ font: "600 11px var(--font-mono)", color: "var(--color-brand-hover)", letterSpacing: "0.05em", marginBottom: 6 }}>PRÉ-VISUALIZAÇÃO</div>
                <div style={{ font: "13px var(--font-sans)", color: "var(--color-text)" }}>
                  <strong>{name || "Produto"}</strong>
                  {optionGroups.map((g) => (
                    <div key={g.id} style={{ marginTop: 4, font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
                      {g.name || "Categoria sem nome"}: {g.items.filter((it) => it.name.trim()).length === 0 ? <em style={{ color: "var(--color-text-faint)" }}>(vazio)</em> : g.items.filter((it) => it.name.trim()).map((it, idx, arr) => (
                        <span key={it.id}>
                          {it.name}{it.priceModifierInCents > 0 ? ` +R$ ${formatCents(it.priceModifierInCents)}` : ""}
                          {idx < arr.length - 1 ? ", " : ""}
                        </span>
                      ))}
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 8, font: "12px var(--font-mono)", color: "var(--color-brand-hover)" }}>
                  Acréscimo máximo: +R$ {formatCents(optionGroups.reduce((sum, g) => sum + g.items.reduce((s, it) => s + Math.max(0, it.priceModifierInCents), 0), 0))}
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </>
  );
}

function Field(props: { label: string; value: string; onChange: (v: string) => void; error?: string; placeholder?: string }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "block", marginBottom: 4 }}>{props.label}</span>
      <input
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${props.error ? "var(--color-error)" : "var(--color-border)"}`, font: "12.5px var(--font-mono)", color: "var(--color-text)", outline: "none", background: "var(--surface-2)" }}
      />
      {props.error ? (
        <span style={{ font: "11px var(--font-sans)", color: "var(--color-error)", marginTop: 4, display: "block" }}>{props.error}</span>
      ) : null}
    </label>
  );
}

function DateTimeField(props: { label: string; type: "date" | "time"; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)", display: "block", marginBottom: 4 }}>{props.label}</span>
      <input
        type={props.type}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--color-border)", font: "12.5px var(--font-mono)", color: "var(--color-text)", outline: "none", background: "var(--surface-2)" }}
      />
    </label>
  );
}
