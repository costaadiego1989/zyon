import React from "react";
import { Plus, Trash2, X } from "lucide-react";
import { PrefixInput } from "../../../components/PrefixInput.js";
import type { ProductVariantDraft } from "../hooks/useVariantManager.js";

export interface VariantManagerProps {
  variants: ProductVariantDraft[];
  hasVariants: boolean;
  productType: "physical" | "digital" | "service";
  formErrors: Record<string, string>;
  onUpdateVariant: (index: number, patch: Partial<ProductVariantDraft>) => void;
  onAddVariant: () => void;
  onRemoveVariant: (index: number) => void;
  onAddAttribute: (variantIdx: number) => void;
  onUpdateAttribute: (variantIdx: number, attrIdx: number, patch: { key?: string; value?: string }) => void;
  onRemoveAttribute: (variantIdx: number, attrIdx: number) => void;
  onToggleVariantsMode: (enabled: boolean) => void;
}

export function VariantManager(props: VariantManagerProps) {
  const {
    variants,
    hasVariants,
    productType,
    formErrors,
    onUpdateVariant,
    onAddVariant,
    onRemoveVariant,
    onAddAttribute,
    onUpdateAttribute,
    onRemoveAttribute,
    onToggleVariantsMode,
  } = props;

  return (
    <>
      {/* SIMPLE PRODUCT MODE - Price & Stock */}
      {!hasVariants && (
        <section style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: "20px 22px" }}>
          <h3 style={{ font: "600 12px var(--font-mono)", color: "var(--color-text-faint)", letterSpacing: "0.05em", marginBottom: 14 }}>
            {productType === "physical" ? "PREÇO E ESTOQUE" : "PREÇO"}
          </h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <Field label="SKU *" value={variants[0].sku} onChange={(val) => onUpdateVariant(0, { sku: val })} error={formErrors["simple_sku"]} placeholder="Auto-gerado do nome se vazio" />
            <PrefixInput prefix="R$" label="Preço *" value={variants[0].basePriceInput} onChange={(val) => onUpdateVariant(0, { basePriceInput: val })} error={formErrors["simple_price"]} placeholder="0,00" />
            {productType === "physical" && (
              <Field label="Estoque" value={variants[0].stockInput} onChange={(val) => onUpdateVariant(0, { stockInput: val })} placeholder="0" />
            )}
          </div>
        </section>
      )}

      {/* DIMENSIONS - SIMPLE MODE & PHYSICAL ONLY */}
      {!hasVariants && productType === "physical" && (
        <section style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: "20px 22px" }}>
          <h3 style={{ font: "600 12px var(--font-mono)", color: "var(--color-text-faint)", letterSpacing: "0.05em", marginBottom: 14 }}>DIMENSÕES</h3>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
            <PrefixInput prefix="g" label="Peso" value={variants[0].weightInput} onChange={(val) => onUpdateVariant(0, { weightInput: val })} error={formErrors["simple_weight"]} placeholder="300" />
            <PrefixInput prefix="cm" label="Comprimento" value={variants[0].lengthInput} onChange={(val) => onUpdateVariant(0, { lengthInput: val })} placeholder="20" />
            <PrefixInput prefix="cm" label="Largura" value={variants[0].widthInput} onChange={(val) => onUpdateVariant(0, { widthInput: val })} placeholder="15" />
            <PrefixInput prefix="cm" label="Altura" value={variants[0].heightInput} onChange={(val) => onUpdateVariant(0, { heightInput: val })} placeholder="5" />
          </div>
        </section>
      )}

      {/* SIMPLE vs COMPLEX TOGGLE */}
      <section style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: "20px 22px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <span style={{ font: "600 12px var(--font-sans)", color: "var(--color-text)" }}>Produto com variantes</span>
          <input
            type="checkbox"
            checked={hasVariants}
            onChange={(e) => onToggleVariantsMode(e.target.checked)}
            style={{ width: 18, height: 18, accentColor: "var(--color-brand-hover)", cursor: "pointer" }}
          />
          <span style={{ font: "12px var(--font-sans)", color: "var(--color-text-faint)" }}>
            {hasVariants ? "Ativado" : "Desativado"}
          </span>
        </label>
      </section>

      {/* COMPLEX VARIANTS MODE */}
      {hasVariants && (
        <section style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: "20px 22px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <h3 style={{ font: "600 12px var(--font-mono)", color: "var(--color-text-faint)", letterSpacing: "0.05em" }}>VARIANTES</h3>
            <button
              type="button"
              onClick={onAddVariant}
              style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--color-border)", background: "var(--surface-1)", color: "var(--color-text)", cursor: "pointer", font: "600 11.5px var(--font-sans)" }}
            >
              <Plus size={12} /> Adicionar variante
            </button>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {variants.map((v, idx) => (
              <div key={idx} style={{ background: "var(--surface-1)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                  <strong style={{ font: "600 12px var(--font-sans)", color: "var(--color-text)" }}>Variante #{idx + 1}</strong>
                  {variants.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => onRemoveVariant(idx)}
                      aria-label="Remover variante"
                      style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--color-error)", background: "var(--color-error-bg)", color: "var(--color-error)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, font: "600 11px var(--font-sans)" }}
                    >
                      <Trash2 size={11} /> Remover
                    </button>
                  ) : null}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
                  <Field label="SKU *" value={v.sku} onChange={(val) => onUpdateVariant(idx, { sku: val })} error={formErrors[`variant_${idx}_sku`]} placeholder="SKU-001" />
                  <PrefixInput prefix="R$" label="Preço *" value={v.basePriceInput} onChange={(val) => onUpdateVariant(idx, { basePriceInput: val })} error={formErrors[`variant_${idx}_price`]} placeholder="0,00" />
                  {productType === "physical" && <Field label="Estoque" value={v.stockInput} onChange={(val) => onUpdateVariant(idx, { stockInput: val })} placeholder="0" />}
                  {productType === "physical" && <PrefixInput prefix="g" label="Peso" value={v.weightInput} onChange={(val) => onUpdateVariant(idx, { weightInput: val })} error={formErrors[`variant_${idx}_weight`]} placeholder="300" />}
                  {productType === "physical" && <PrefixInput prefix="cm" label="Comprimento" value={v.lengthInput} onChange={(val) => onUpdateVariant(idx, { lengthInput: val })} placeholder="20" />}
                  {productType === "physical" && <PrefixInput prefix="cm" label="Largura" value={v.widthInput} onChange={(val) => onUpdateVariant(idx, { widthInput: val })} placeholder="15" />}
                  {productType === "physical" && <PrefixInput prefix="cm" label="Altura" value={v.heightInput} onChange={(val) => onUpdateVariant(idx, { heightInput: val })} placeholder="5" />}
                </div>

                {/* ATTRIBUTES */}
                <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--color-border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                    <span style={{ font: "600 11px var(--font-sans)", color: "var(--color-text)" }}>Atributos</span>
                    <button
                      type="button"
                      onClick={() => onAddAttribute(idx)}
                      style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--color-border)", background: "transparent", color: "var(--color-text)", cursor: "pointer", font: "600 11px var(--font-sans)" }}
                    >
                      <Plus size={10} /> Adicionar
                    </button>
                  </div>
                  {v.attributes.length === 0 ? (
                    <div style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>Nenhum atributo</div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {v.attributes.map((attr, attrIdx) => (
                        <div key={attrIdx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "start" }}>
                          <input
                            value={attr.key}
                            onChange={(e) => onUpdateAttribute(idx, attrIdx, { key: e.target.value })}
                            placeholder="Ex: Cor"
                            style={{ padding: "6px 8px", borderRadius: 4, border: "1px solid var(--color-border)", font: "11px var(--font-mono)", color: "var(--color-text)", outline: "none", background: "var(--surface-2)" }}
                          />
                          <input
                            value={attr.value}
                            onChange={(e) => onUpdateAttribute(idx, attrIdx, { value: e.target.value })}
                            placeholder="Ex: Preto"
                            style={{ padding: "6px 8px", borderRadius: 4, border: "1px solid var(--color-border)", font: "11px var(--font-mono)", color: "var(--color-text)", outline: "none", background: "var(--surface-2)" }}
                          />
                          <button
                            type="button"
                            onClick={() => onRemoveAttribute(idx, attrIdx)}
                            aria-label="Remover atributo"
                            style={{ padding: "4px 6px", borderRadius: 4, border: "1px solid var(--color-error)", background: "var(--color-error-bg)", color: "var(--color-error)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", font: "600 10px var(--font-sans)" }}
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
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
