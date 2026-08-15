import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Save, Trash2, Upload, X, Image as ImageIcon } from "lucide-react";
import type { MerchantProfile, Product } from "../api-client.js";
import { useApi } from "../hooks/useApi.js";
import { SaveFeedbackBanner } from "../components/save-feedback-banner.js";

export interface ProductVariantDraft {
  id?: string;
  sku: string;
  basePriceInput: string;
  costInput: string;
  weightInput: string;
  lengthInput: string;
  widthInput: string;
  heightInput: string;
  stockInput: string;
}

export interface ProductDetailPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
  productId: string | null;
  onBack?: () => void;
  onSaved?: () => void;
}

export function emptyVariant(): ProductVariantDraft {
  return {
    sku: "",
    basePriceInput: "",
    costInput: "",
    weightInput: "",
    lengthInput: "",
    widthInput: "",
    heightInput: "",
    stockInput: "0",
  };
}

export function parseInteger(value: string): number | null {
  if (!value.trim()) return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : null;
}

export function parseFloatSafe(value: string): number | null {
  if (!value.trim()) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
}

export function validateVariants(variants: ProductVariantDraft[]): Record<string, string> {
  const errors: Record<string, string> = {};
  if (variants.length === 0) {
    errors["variants"] = "Adicione pelo menos uma variante";
    return errors;
  }
  const seenSkus = new Set<string>();
  variants.forEach((v, idx) => {
    if (!v.sku.trim()) errors[`variant_${idx}_sku`] = "SKU obrigatório";
    else if (seenSkus.has(v.sku.trim())) errors[`variant_${idx}_sku`] = "SKU duplicado";
    else seenSkus.add(v.sku.trim());

    const price = parseInteger(v.basePriceInput);
    if (price === null || price <= 0) errors[`variant_${idx}_price`] = "Preço inválido";

    if (v.weightInput.trim()) {
      const w = parseFloatSafe(v.weightInput);
      if (w === null || w < 0) errors[`variant_${idx}_weight`] = "Peso inválido";
    }

    if (v.costInput.trim()) {
      const c = parseInteger(v.costInput);
      if (c === null || c < 0) errors[`variant_${idx}_cost`] = "Custo inválido";
    }
  });
  return errors;
}

export function ProductDetailPage(props: ProductDetailPageProps) {
  const api = useApi();
  const merchantId = props.me?.id;
  const isEditing = !!props.productId;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [variants, setVariants] = useState<ProductVariantDraft[]>([emptyVariant()]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveResult, setSaveResult] = useState<"success" | "error" | null>(null);
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [variantMedia, setVariantMedia] = useState<Record<string, Array<{ id: string; url: string }>>>({});
  const [uploadingVariant, setUploadingVariant] = useState<string | null>(null);

  useEffect(() => {
    if (!merchantId) return;
    api.listCategories?.(merchantId).then(setCategories).catch(() => {});
  }, [api, merchantId]);

  useEffect(() => {
    if (!merchantId || !isEditing || !props.productId) {
      setLoaded(true);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setLoaded(false);
    (async () => {
      try {
        const product = await api.getProduct(merchantId, props.productId!);
        setName(product.name);
        setDescription(product.description ?? "");
        setCategoryId(product.categoryId ?? "");
        setIsActive(product.isActive);
        const mediaMap: Record<string, Array<{ id: string; url: string }>> = {};
        setVariants(
          product.variants.length > 0
            ? product.variants.map((v) => {
                if (v.media?.length) {
                  mediaMap[v.id] = v.media.map((m) => ({ id: m.id, url: m.url }));
                }
                return {
                  id: v.id,
                  sku: v.sku,
                  basePriceInput: String(v.basePriceInCents ?? 0),
                  costInput: v.costInCents != null ? String(v.costInCents) : "",
                  weightInput: v.weightGrams != null ? String(v.weightGrams) : "",
                  lengthInput: v.lengthCm != null ? String(v.lengthCm) : "",
                  widthInput: v.widthCm != null ? String(v.widthCm) : "",
                  heightInput: v.heightCm != null ? String(v.heightCm) : "",
                  stockInput: String(v.stockQuantity ?? 0),
                };
              })
            : [emptyVariant()],
        );
        setVariantMedia(mediaMap);
      } catch (e) {
        setLoadError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
        setLoaded(true);
      }
    })();
  }, [api, merchantId, props.productId, isEditing]);

  const variantErrors = useMemo(() => validateVariants(variants), [variants]);

  function updateVariant(index: number, patch: Partial<ProductVariantDraft>) {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  }

  function addVariant() {
    setVariants((prev) => [...prev, emptyVariant()]);
  }

  function removeVariant(index: number) {
    setVariants((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  const formErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!name.trim()) errors["name"] = "Nome obrigatório";
    Object.assign(errors, variantErrors);
    return errors;
  }, [name, variantErrors]);

  const canSave = Object.keys(formErrors).length === 0 && !saving && loaded;

  async function handleSave() {
    if (!merchantId) return;
    if (Object.keys(formErrors).length > 0) {
      setSaveResult("error");
      setSaveErrorMsg("Corrija os erros antes de salvar");
      return;
    }
    setSaving(true);
    setSaveResult(null);
    try {
      const payloadVariants = variants.map((v) => ({
        sku: v.sku.trim(),
        attributes: {},
        basePriceInCents: parseInteger(v.basePriceInput) ?? 0,
        costInCents: v.costInput.trim() ? parseInteger(v.costInput) ?? undefined : undefined,
        weightGrams: v.weightInput.trim() ? parseFloatSafe(v.weightInput) ?? undefined : undefined,
        lengthCm: v.lengthInput.trim() ? parseFloatSafe(v.lengthInput) ?? undefined : undefined,
        widthCm: v.widthInput.trim() ? parseFloatSafe(v.widthInput) ?? undefined : undefined,
        heightCm: v.heightInput.trim() ? parseFloatSafe(v.heightInput) ?? undefined : undefined,
        stockQuantity: parseInteger(v.stockInput) ?? 0,
      }));

      if (isEditing && props.productId) {
        await api.updateProduct(merchantId, props.productId, {
          name: name.trim(),
          description: description.trim() || undefined,
          categoryId: categoryId.trim() || undefined,
          isActive,
        });
      } else {
        await api.createProduct(merchantId, {
          name: name.trim(),
          description: description.trim() || undefined,
          categoryId: categoryId.trim() || undefined,
          variants: payloadVariants,
        });
      }
      setSaveResult("success");
      setSaveErrorMsg(null);
      props.onSaved?.();
    } catch (e) {
      setSaveResult("error");
      setSaveErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <h1>Produto</h1>
          <p className="page-lead">Login necessário.</p>
        </div>
      </header>
    );
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <button
            type="button"
            onClick={() => props.onBack?.()}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "4px 0", border: "none", background: "transparent", cursor: "pointer", color: "var(--muted)", font: "600 11.5px var(--sans)", marginBottom: 8 }}
          >
            <ArrowLeft size={12} /> Voltar para o catálogo
          </button>
          <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>LOJA / CATÁLOGO</div>
          <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>{isEditing ? "Editar produto" : "Novo produto"}</h1>
        </div>
        <button
          type="button"
          onClick={() => void handleSave()}
          disabled={!canSave}
          style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--accent-dark)", background: "var(--accent-dark)", font: "600 12.5px var(--sans)", color: "white", cursor: canSave ? "pointer" : "not-allowed", opacity: canSave ? 1 : 0.6, flex: "none" }}
        >
          <Save size={14} /> {saving ? "Salvando..." : isEditing ? "Salvar alterações" : "Criar produto"}
        </button>
      </div>

      <SaveFeedbackBanner
        result={saveResult}
        errorMessage={saveErrorMsg ?? undefined}
        successMessage={isEditing ? "Produto atualizado" : "Produto criado"}
        onDismiss={() => setSaveResult(null)}
      />

      {loadError ? (
        <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--danger-soft)", border: "1px solid var(--danger)", font: "13px var(--sans)", color: "var(--danger)", marginBottom: 16 }}>
          {loadError}
        </div>
      ) : null}

      {loading ? (
        <div style={{ padding: "40px 22px", textAlign: "center", color: "var(--faint)", font: "13px var(--sans)" }}>Carregando produto...</div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
          <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
            <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>INFORMAÇÕES BÁSICAS</h3>
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ font: "600 12px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Nome *</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: Camiseta preta M"
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: `1px solid ${formErrors["name"] ? "var(--danger)" : "var(--border)"}`, font: "13px var(--sans)", color: "var(--ink)", outline: "none", background: "var(--bg)" }}
              />
              {formErrors["name"] ? (
                <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{formErrors["name"]}</span>
              ) : null}
            </label>
            <label style={{ display: "block", marginBottom: 12 }}>
              <span style={{ font: "600 12px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Descrição</span>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="Detalhes do produto..."
                style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", font: "13px var(--sans)", color: "var(--ink)", outline: "none", background: "var(--bg)", resize: "vertical" }}
              />
            </label>
            <label style={{ display: "block", marginBottom: isEditing ? 12 : 0 }}>
              <span style={{ font: "600 12px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Categoria</span>
              {categories.length > 0 ? (
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
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
                  onChange={(e) => setCategoryId(e.target.value)}
                  placeholder="Ex: cat_abc123"
                  style={{ width: "100%", padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", font: "13px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--bg)" }}
                />
              )}
            </label>
            {isEditing && (
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                <span style={{ font: "600 12px var(--sans)", color: "var(--ink)" }}>Produto ativo</span>
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  style={{ width: 18, height: 18, accentColor: "var(--accent-dark)", cursor: "pointer" }}
                />
                <span style={{ font: "12px var(--sans)", color: "var(--faint)" }}>{isActive ? "Ativo" : "Inativo"}</span>
              </label>
            )}
          </section>

          <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em" }}>VARIANTES</h3>
              <button
                type="button"
                onClick={addVariant}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", cursor: "pointer", font: "600 11.5px var(--sans)" }}
              >
                <Plus size={12} /> Adicionar variante
              </button>
            </div>
            {formErrors["variants"] ? (
              <div style={{ padding: "8px 12px", borderRadius: 6, background: "var(--danger-soft)", border: "1px solid var(--danger)", font: "12px var(--sans)", color: "var(--danger)", marginBottom: 12 }}>
                {formErrors["variants"]}
              </div>
            ) : null}

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {variants.map((v, idx) => (
                <div key={idx} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <strong style={{ font: "600 12px var(--sans)", color: "var(--ink)" }}>Variante #{idx + 1}</strong>
                    {variants.length > 1 ? (
                      <button
                        type="button"
                        onClick={() => removeVariant(idx)}
                        aria-label="Remover variante"
                        style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--danger)", background: "var(--danger-soft)", color: "var(--danger)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, font: "600 11px var(--sans)" }}
                      >
                        <Trash2 size={11} /> Remover
                      </button>
                    ) : null}
                  </div>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
                    <Field
                      label="SKU *"
                      value={v.sku}
                      onChange={(val) => updateVariant(idx, { sku: val })}
                      error={variantErrors[`variant_${idx}_sku`]}
                      placeholder="SKU-001"
                    />
                    <Field
                      label="Preço base (centavos) *"
                      value={v.basePriceInput}
                      onChange={(val) => updateVariant(idx, { basePriceInput: val })}
                      error={variantErrors[`variant_${idx}_price`]}
                      placeholder="9990"
                    />
                    <Field
                      label="Custo (centavos)"
                      value={v.costInput}
                      onChange={(val) => updateVariant(idx, { costInput: val })}
                      error={variantErrors[`variant_${idx}_cost`]}
                      placeholder="3500"
                    />
                    <Field
                      label="Estoque"
                      value={v.stockInput}
                      onChange={(val) => updateVariant(idx, { stockInput: val })}
                      placeholder="0"
                    />
                    <Field
                      label="Peso (g)"
                      value={v.weightInput}
                      onChange={(val) => updateVariant(idx, { weightInput: val })}
                      error={variantErrors[`variant_${idx}_weight`]}
                      placeholder="300"
                    />
                    <Field
                      label="Comprimento (cm)"
                      value={v.lengthInput}
                      onChange={(val) => updateVariant(idx, { lengthInput: val })}
                      placeholder="20"
                    />
                    <Field
                      label="Largura (cm)"
                      value={v.widthInput}
                      onChange={(val) => updateVariant(idx, { widthInput: val })}
                      placeholder="15"
                    />
                    <Field
                      label="Altura (cm)"
                      value={v.heightInput}
                      onChange={(val) => updateVariant(idx, { heightInput: val })}
                      placeholder="5"
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          {isEditing && (
            <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
              <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>IMAGENS</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {variants.map((v, idx) => (
                  <div key={idx} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px" }}>
                    <div style={{ marginBottom: 12 }}>
                      <strong style={{ font: "600 12px var(--sans)", color: "var(--ink)" }}>Variante #{idx + 1} — {v.sku}</strong>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 10, marginBottom: 14 }}>
                      {(variantMedia[v.id!] || []).map((media) => (
                        <div key={media.id} style={{ position: "relative", borderRadius: 8, overflow: "hidden", aspectRatio: "1", background: "var(--border)" }}>
                          <img src={media.url} alt="Produto" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          <button
                            type="button"
                            onClick={async () => {
                              setUploadingVariant(v.id!);
                              try {
                                await api.deleteProductMedia?.(merchantId!, media.id);
                                setVariantMedia((prev) => ({
                                  ...prev,
                                  [v.id!]: (prev[v.id!] || []).filter((m) => m.id !== media.id),
                                }));
                              } finally {
                                setUploadingVariant(null);
                              }
                            }}
                            disabled={uploadingVariant === v.id}
                            aria-label="Remover imagem"
                            style={{ position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: 4, background: "rgba(0,0,0,0.7)", border: "none", color: "white", cursor: uploadingVariant === v.id ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", font: "600 12px var(--sans)", opacity: uploadingVariant === v.id ? 0.6 : 1 }}
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ))}
                      <label style={{ borderRadius: 8, border: "2px dashed var(--border)", background: "var(--bg)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", aspectRatio: "1", cursor: uploadingVariant === v.id ? "not-allowed" : "pointer", opacity: uploadingVariant === v.id ? 0.6 : 1 }}>
                        <ImageIcon size={24} style={{ color: "var(--faint)", marginBottom: 4 }} />
                        <span style={{ font: "11px var(--sans)", color: "var(--faint)", textAlign: "center" }}>Upload</span>
                        <input
                          type="file"
                          accept="image/*"
                          onChange={async (e) => {
                            const file = e.currentTarget.files?.[0];
                            if (!file || !merchantId || !v.id) return;
                            setUploadingVariant(v.id);
                            try {
                              const reader = new FileReader();
                              reader.onload = async (re) => {
                                try {
                                  const base64 = re.target?.result as string;
                                  const result = await api.uploadProductMedia?.(merchantId, v.id!, base64);
                                  if (result) {
                                    setVariantMedia((prev) => ({
                                      ...prev,
                                      [v.id!]: [...(prev[v.id!] || []), { id: result.id, url: result.url }],
                                    }));
                                  }
                                } finally {
                                  setUploadingVariant(null);
                                }
                              };
                              reader.readAsDataURL(file);
                            } catch (err) {
                              setUploadingVariant(null);
                            }
                            e.currentTarget.value = "";
                          }}
                          disabled={uploadingVariant === v.id}
                          style={{ display: "none" }}
                        />
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
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