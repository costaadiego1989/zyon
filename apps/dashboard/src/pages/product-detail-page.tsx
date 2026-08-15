import React, { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Plus, Save, Trash2, Upload, X, Image as ImageIcon, Package, Download, Clock } from "lucide-react";
import type { MerchantProfile, Product } from "../api-client.js";
import { useApi } from "../hooks/useApi.js";
import { SaveFeedbackBanner } from "../components/save-feedback-banner.js";

export type ProductType = "physical" | "digital" | "service";

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
  attributes: Array<{ key: string; value: string }>;
  pendingImages: string[];
}

export interface ProductMetadata {
  // Digital
  downloadUrl?: string;
  fileSize?: string;
  fileFormat?: string;
  // Service
  serviceType?: "presencial" | "remoto" | "hibrido"; // presencial, remoto ou híbrido
  startDate?: string; // ISO date: 2026-08-15
  startTime?: string; // HH:mm: 09:00
  endDate?: string;
  endTime?: string;
  remoteLink?: string; // zoom/meet link
  notes?: string;
}

export interface ProductDetailPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
  productId: string | null;
  onBack?: () => void;
  onSaved?: () => void;
}

// Price conversion helpers: REAIS ↔ CENTAVOS
export function centsToReais(cents: number): string {
  return (cents / 100).toFixed(2);
}

export function reaisToCents(input: string): number {
  const clean = input.replace(",", ".").replace(/[^\d.]/g, "");
  return Math.round(parseFloat(clean) * 100) || 0;
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
    attributes: [],
    pendingImages: [],
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

    const price = reaisToCents(v.basePriceInput);
    if (price <= 0) errors[`variant_${idx}_price`] = "Preço inválido";

    if (v.weightInput.trim()) {
      const w = parseFloatSafe(v.weightInput);
      if (w === null || w < 0) errors[`variant_${idx}_weight`] = "Peso inválido";
    }

    if (v.costInput.trim()) {
      const c = reaisToCents(v.costInput);
      if (c < 0) errors[`variant_${idx}_cost`] = "Custo inválido";
    }
  });
  return errors;
}

export function ProductDetailPage(props: ProductDetailPageProps) {
  const api = useApi();
  const merchantId = props.me?.id;
  const isEditing = !!props.productId;

  const [productType, setProductType] = useState<ProductType>("physical");
  const [metadata, setMetadata] = useState<ProductMetadata>({});
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [hasVariants, setHasVariants] = useState(false);
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
  const [createdProductId, setCreatedProductId] = useState<string | null>(null);

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
        setProductType((product.type as ProductType) ?? "physical");
        setMetadata((product.metadata as Record<string, unknown> as ProductMetadata) ?? {});
        setCategoryId(product.categoryId ?? "");
        setIsActive(product.isActive);
        const mediaMap: Record<string, Array<{ id: string; url: string }>> = {};
        const isComplex = product.variants.length !== 1;
        setHasVariants(isComplex);
        setVariants(
          product.variants.length > 0
            ? product.variants.map((v) => {
                if (v.media?.length) {
                  mediaMap[v.id] = v.media.map((m) => ({ id: m.id, url: m.url }));
                }
                return {
                  id: v.id,
                  sku: v.sku,
                  basePriceInput: centsToReais(v.basePriceInCents ?? 0),
                  costInput: v.costInCents != null ? centsToReais(v.costInCents) : "",
                  weightInput: v.weightGrams != null ? String(v.weightGrams) : "",
                  lengthInput: v.lengthCm != null ? String(v.lengthCm) : "",
                  widthInput: v.widthCm != null ? String(v.widthCm) : "",
                  heightInput: v.heightCm != null ? String(v.heightCm) : "",
                  stockInput: String(v.stockQuantity ?? 0),
                  attributes: Object.entries(v.attributes || {}).map(([key, value]) => ({ key, value })),
                  pendingImages: [],
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

  const variantErrors = useMemo(() => {
    if (hasVariants) return validateVariants(variants);
    // Simple product: just validate first variant
    const simpleErrors: Record<string, string> = {};
    const v = variants[0];
    if (!v.sku.trim()) simpleErrors["simple_sku"] = "SKU obrigatório";
    const price = reaisToCents(v.basePriceInput);
    if (price <= 0) simpleErrors["simple_price"] = "Preço inválido";
    if (v.weightInput.trim()) {
      const w = parseFloatSafe(v.weightInput);
      if (w === null || w < 0) simpleErrors["simple_weight"] = "Peso inválido";
    }
    if (v.costInput.trim()) {
      const c = reaisToCents(v.costInput);
      if (c < 0) simpleErrors["simple_cost"] = "Custo inválido";
    }
    return simpleErrors;
  }, [variants, hasVariants]);

  function updateVariant(index: number, patch: Partial<ProductVariantDraft>) {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  }

  function addVariant() {
    setVariants((prev) => [...prev, emptyVariant()]);
  }

  function removeVariant(index: number) {
    setVariants((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }

  function addAttribute(variantIdx: number) {
    updateVariant(variantIdx, {
      attributes: [...(variants[variantIdx]?.attributes || []), { key: "", value: "" }],
    });
  }

  function updateAttribute(variantIdx: number, attrIdx: number, patch: { key?: string; value?: string }) {
    const newAttrs = [...(variants[variantIdx]?.attributes || [])];
    newAttrs[attrIdx] = { ...newAttrs[attrIdx], ...patch };
    updateVariant(variantIdx, { attributes: newAttrs });
  }

  function removeAttribute(variantIdx: number, attrIdx: number) {
    const newAttrs = (variants[variantIdx]?.attributes || []).filter((_, i) => i !== attrIdx);
    updateVariant(variantIdx, { attributes: newAttrs });
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
      // Auto-generate SKU if not provided and simple product
      let skuToUse = variants[0].sku.trim();
      if (!skuToUse && !hasVariants) {
        skuToUse = name.toLowerCase().replace(/\s+/g, "-").slice(0, 32);
      }

      const payloadVariants = variants.map((v) => ({
        sku: hasVariants ? v.sku.trim() : skuToUse,
        attributes: v.attributes.reduce(
          (acc, attr) => {
            if (attr.key.trim()) acc[attr.key.trim()] = attr.value.trim();
            return acc;
          },
          {} as Record<string, string>,
        ),
        basePriceInCents: reaisToCents(v.basePriceInput),
        costInCents: v.costInput.trim() ? reaisToCents(v.costInput) : undefined,
        weightGrams: v.weightInput.trim() ? parseFloatSafe(v.weightInput) ?? undefined : undefined,
        lengthCm: v.lengthInput.trim() ? parseFloatSafe(v.lengthInput) ?? undefined : undefined,
        widthCm: v.widthInput.trim() ? parseFloatSafe(v.widthInput) ?? undefined : undefined,
        heightCm: v.heightInput.trim() ? parseFloatSafe(v.heightInput) ?? undefined : undefined,
        stockQuantity: parseInteger(v.stockInput) ?? 0,
      }));

      let productId = props.productId;

      if (isEditing && props.productId) {
        await api.updateProduct(merchantId, props.productId, {
          name: name.trim(),
          description: description.trim() || undefined,
          type: productType,
          metadata: metadata as Record<string, unknown>,
          categoryId: categoryId.trim() || undefined,
          isActive,
        });
        // Update variants
        for (let i = 0; i < payloadVariants.length; i++) {
          const v = payloadVariants[i];
          const existing = variants[i];
          if (existing?.id) {
            try {
              await api.updateVariant?.(merchantId, props.productId, existing.id, {
                basePriceInCents: v.basePriceInCents,
                costInCents: v.costInCents ?? null,
                stockQuantity: v.stockQuantity,
                weightGrams: v.weightGrams ?? null,
                lengthCm: v.lengthCm ?? null,
                widthCm: v.widthCm ?? null,
                heightCm: v.heightCm ?? null,
              });
            } catch { /* non-critical */ }
          }
        }
      } else {
        const created = await api.createProduct(merchantId, {
          name: name.trim(),
          description: description.trim() || undefined,
          type: productType,
          metadata: metadata as Record<string, unknown>,
          categoryId: categoryId.trim() || undefined,
          variants: payloadVariants,
        });
        productId = created.id;
        setCreatedProductId(created.id);
      }

      // Upload pending images after product creation
      if (productId) {
        for (let i = 0; i < variants.length; i++) {
          const v = variants[i];
          const variantId = isEditing ? v.id : (i < payloadVariants.length ? productId : null);
          if (variantId && v.pendingImages.length > 0) {
            for (const base64 of v.pendingImages) {
              try {
                const result = await api.uploadProductMedia?.(merchantId, variantId, base64);
                if (result) {
                  setVariantMedia((prev) => ({
                    ...prev,
                    [variantId]: [...(prev[variantId] || []), { id: result.id, url: result.url }],
                  }));
                }
              } catch { /* non-critical */ }
            }
          }
        }
        // Clear pending images after upload
        setVariants((prev) => prev.map((v) => ({ ...v, pendingImages: [] })));
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
          {/* PRODUCT TYPE SELECTOR */}
          <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
            <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>TIPO DE PRODUTO</h3>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
              {(["physical", "digital", "service"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  onClick={() => setProductType(type)}
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

          {/* IMAGES SECTION - FIRST */}
          <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
            <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>IMAGENS</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {variants.map((v, idx) => (
                <div key={idx} style={{ background: "var(--bg)", border: "1px solid var(--border)", borderRadius: 10, padding: "16px" }}>
                  <div style={{ marginBottom: 12 }}>
                    <strong style={{ font: "600 12px var(--sans)", color: "var(--ink)" }}>
                      {hasVariants ? `Variante #${idx + 1} — ${v.sku}` : "Imagens do produto"}
                    </strong>
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
                          style={{ position: "absolute", top: 4, right: 4, width: 24, height: 24, borderRadius: 4, background: "rgba(0,0,0,0.5)", border: "none", color: "white", cursor: uploadingVariant === v.id ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", lineHeight: 1, opacity: uploadingVariant === v.id ? 0.6 : 1 }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    {/* Pending images (create mode — not yet uploaded) */}
                    {(v.pendingImages || []).map((base64, imgIdx) => (
                      <div key={`pending-${imgIdx}`} style={{ position: "relative", borderRadius: 8, overflow: "hidden", aspectRatio: "1", background: "var(--border)" }}>
                        <img src={base64} alt="Pendente" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.7 }} />
                        <div style={{ position: "absolute", bottom: 4, left: 4, padding: "2px 6px", borderRadius: 4, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: "9px", fontWeight: 600 }}>Pendente</div>
                        <button
                          type="button"
                          onClick={() => updateVariant(idx, { pendingImages: v.pendingImages.filter((_, i) => i !== imgIdx) })}
                          aria-label="Remover imagem pendente"
                          style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 4, background: "rgba(0,0,0,0.5)", border: "none", color: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", lineHeight: 1 }}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <label style={{ borderRadius: 8, border: "2px dashed var(--border)", background: "var(--bg)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", aspectRatio: "1", cursor: (uploadingVariant === v.id || uploadingVariant === `pending-${idx}`) ? "not-allowed" : "pointer", opacity: (uploadingVariant === v.id || uploadingVariant === `pending-${idx}`) ? 0.6 : 1 }}>
                      {(uploadingVariant === v.id || uploadingVariant === `pending-${idx}`) ? (
                        <>
                          <div style={{ width: 20, height: 20, border: "2px solid var(--faint)", borderTopColor: "var(--accent-dark)", borderRadius: "50%", animation: "spin 0.8s linear infinite", marginBottom: 4 }} />
                          <span style={{ font: "11px var(--sans)", color: "var(--accent-dark)", textAlign: "center" }}>Enviando...</span>
                        </>
                      ) : (
                        <>
                          <ImageIcon size={24} style={{ color: "var(--faint)", marginBottom: 4 }} />
                          <span style={{ font: "11px var(--sans)", color: "var(--faint)", textAlign: "center" }}>Upload</span>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        onChange={async (e) => {
                          const file = e.currentTarget.files?.[0];
                          if (!file || !merchantId) return;
                          setUploadingVariant(v.id || `pending-${idx}`);
                          try {
                            const reader = new FileReader();
                            reader.onload = async (re) => {
                              try {
                                const base64 = re.target?.result as string;
                                if (v.id) {
                                  const result = await api.uploadProductMedia?.(merchantId, v.id, base64);
                                  if (result) {
                                    setVariantMedia((prev) => ({
                                      ...prev,
                                      [v.id!]: [...(prev[v.id!] || []), { id: result.id, url: result.url }],
                                    }));
                                  }
                                } else {
                                  updateVariant(idx, {
                                    pendingImages: [...(variants[idx]?.pendingImages || []), base64],
                                  });
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
                        disabled={uploadingVariant === v.id || uploadingVariant === `pending-${idx}`}
                        style={{ display: "none" }}
                      />
                    </label>
                  </div>
                </div>
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
            <label style={{ display: "block", marginBottom: 12 }}>
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
                <span style={{ font: "600 12px var(--sans)", color: "var(--ink)" }}>Ativo</span>
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
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
                <Field
                  label="URL de Download"
                  value={metadata.downloadUrl ?? ""}
                  onChange={(val) => setMetadata({ ...metadata, downloadUrl: val })}
                  placeholder="https://example.com/download/arquivo"
                />
                <Field
                  label="Tamanho do arquivo"
                  value={metadata.fileSize ?? ""}
                  onChange={(val) => setMetadata({ ...metadata, fileSize: val })}
                  placeholder="Ex: 15.5 MB, 320 KB"
                />
                <Field
                  label="Formato"
                  value={metadata.fileFormat ?? ""}
                  onChange={(val) => setMetadata({ ...metadata, fileFormat: val })}
                  placeholder="Ex: PDF, ZIP, MP3"
                />
              </div>
            </section>
          )}

          {/* SERVICE-ONLY FIELDS */}
          {productType === "service" && (
            <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
              <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>AGENDAMENTO DO SERVIÇO</h3>
              <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
                {/* Service Type Selection */}
                <div>
                  <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 8 }}>Tipo de serviço *</span>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                    {(["presencial", "remoto", "hibrido"] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setMetadata({ ...metadata, serviceType: type })}
                        style={{
                          padding: "10px",
                          borderRadius: 8,
                          border: `1px solid ${metadata.serviceType === type ? "var(--accent-dark)" : "var(--border)"}`,
                          background: metadata.serviceType === type ? "var(--accent-soft)" : "var(--bg)",
                          color: metadata.serviceType === type ? "var(--accent-dark)" : "var(--ink)",
                          cursor: "pointer",
                          font: "600 11px var(--sans)",
                          transition: "all 0.15s",
                        }}
                      >
                        {type === "presencial" && "🏢 Presencial"}
                        {type === "remoto" && "💻 Remoto"}
                        {type === "hibrido" && "🔄 Híbrido"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Date & Time */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
                  <label style={{ display: "block" }}>
                    <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Data Inicial</span>
                    <input
                      type="date"
                      value={metadata.startDate ?? ""}
                      onChange={(e) => setMetadata({ ...metadata, startDate: e.target.value })}
                      style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12.5px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--card)" }}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Hora Inicial</span>
                    <input
                      type="time"
                      value={metadata.startTime ?? ""}
                      onChange={(e) => setMetadata({ ...metadata, startTime: e.target.value })}
                      style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12.5px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--card)" }}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Data Final</span>
                    <input
                      type="date"
                      value={metadata.endDate ?? ""}
                      onChange={(e) => setMetadata({ ...metadata, endDate: e.target.value })}
                      style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12.5px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--card)" }}
                    />
                  </label>
                  <label style={{ display: "block" }}>
                    <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Hora Final</span>
                    <input
                      type="time"
                      value={metadata.endTime ?? ""}
                      onChange={(e) => setMetadata({ ...metadata, endTime: e.target.value })}
                      style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12.5px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--card)" }}
                    />
                  </label>
                </div>

                {/* Remote Link (conditional) */}
                {(metadata.serviceType === "remoto" || metadata.serviceType === "hibrido") && (
                  <label style={{ display: "block" }}>
                    <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Link da reunião (Zoom / Google Meet)</span>
                    <input
                      value={metadata.remoteLink ?? ""}
                      onChange={(e) => setMetadata({ ...metadata, remoteLink: e.target.value })}
                      placeholder="https://zoom.us/j/... ou https://meet.google.com/..."
                      style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12.5px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--card)" }}
                    />
                    <span style={{ font: "10px var(--sans)", color: "var(--faint)", marginTop: 4, display: "block" }}>🔜 Em breve: integração automática com Zoom e Google Meet</span>
                  </label>
                )}

                {/* Notes / Observações */}
                <label style={{ display: "block" }}>
                  <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Observações</span>
                  <textarea
                    value={metadata.notes ?? ""}
                    onChange={(e) => setMetadata({ ...metadata, notes: e.target.value })}
                    rows={3}
                    placeholder="Ex: Trazer documento XYZ, Material disponível em PDF..."
                    style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid var(--border)", font: "12.5px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--card)", resize: "vertical" }}
                  />
                </label>
              </div>
            </section>
          )}

          {/* SIMPLE PRODUCT MODE - Price & Stock */}
          {!hasVariants && (
            <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
              <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>PREÇO E ESTOQUE</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
                <Field
                  label="SKU *"
                  value={variants[0].sku}
                  onChange={(val) => updateVariant(0, { sku: val })}
                  error={formErrors["simple_sku"]}
                  placeholder="Auto-gerado do nome se vazio"
                />
                <Field
                  label="Preço (R$) *"
                  value={variants[0].basePriceInput}
                  onChange={(val) => updateVariant(0, { basePriceInput: val })}
                  error={formErrors["simple_price"]}
                  placeholder="89,90"
                />
                <Field
                  label="Custo (R$)"
                  value={variants[0].costInput}
                  onChange={(val) => updateVariant(0, { costInput: val })}
                  error={formErrors["simple_cost"]}
                  placeholder="35,00"
                />
                <Field
                  label="Estoque"
                  value={variants[0].stockInput}
                  onChange={(val) => updateVariant(0, { stockInput: val })}
                  placeholder="0"
                />
              </div>
            </section>
          )}

          {/* DIMENSIONS - SIMPLE MODE & PHYSICAL ONLY */}
          {!hasVariants && productType === "physical" && (
            <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
              <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>DIMENSÕES</h3>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 12 }}>
                <Field
                  label="Peso (g)"
                  value={variants[0].weightInput}
                  onChange={(val) => updateVariant(0, { weightInput: val })}
                  error={formErrors["simple_weight"]}
                  placeholder="300"
                />
                <Field
                  label="Comprimento (cm)"
                  value={variants[0].lengthInput}
                  onChange={(val) => updateVariant(0, { lengthInput: val })}
                  placeholder="20"
                />
                <Field
                  label="Largura (cm)"
                  value={variants[0].widthInput}
                  onChange={(val) => updateVariant(0, { widthInput: val })}
                  placeholder="15"
                />
                <Field
                  label="Altura (cm)"
                  value={variants[0].heightInput}
                  onChange={(val) => updateVariant(0, { heightInput: val })}
                  placeholder="5"
                />
              </div>
            </section>
          )}

          {/* SIMPLE vs COMPLEX TOGGLE */}
          <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
              <span style={{ font: "600 12px var(--sans)", color: "var(--ink)" }}>Produto com variantes</span>
              <input
                type="checkbox"
                checked={hasVariants}
                onChange={(e) => {
                  setHasVariants(e.target.checked);
                  if (!e.target.checked) {
                    setVariants([emptyVariant()]);
                  }
                }}
                style={{ width: 18, height: 18, accentColor: "var(--accent-dark)", cursor: "pointer" }}
              />
              <span style={{ font: "12px var(--sans)", color: "var(--faint)" }}>
                {hasVariants ? "Ativado" : "Desativado"}
              </span>
            </label>
          </section>

          {/* COMPLEX VARIANTS MODE */}
          {hasVariants && (
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
                        error={formErrors[`variant_${idx}_sku`]}
                        placeholder="SKU-001"
                      />
                      <Field
                        label="Preço (R$) *"
                        value={v.basePriceInput}
                        onChange={(val) => updateVariant(idx, { basePriceInput: val })}
                        error={formErrors[`variant_${idx}_price`]}
                        placeholder="89,90"
                      />
                      <Field
                        label="Custo (R$)"
                        value={v.costInput}
                        onChange={(val) => updateVariant(idx, { costInput: val })}
                        error={formErrors[`variant_${idx}_cost`]}
                        placeholder="35,00"
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
                        error={formErrors[`variant_${idx}_weight`]}
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

                    {/* ATTRIBUTES */}
                    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <span style={{ font: "600 11px var(--sans)", color: "var(--ink)" }}>Atributos</span>
                        <button
                          type="button"
                          onClick={() => addAttribute(idx)}
                          style={{ display: "inline-flex", alignItems: "center", gap: 2, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--border)", background: "transparent", color: "var(--ink)", cursor: "pointer", font: "600 11px var(--sans)" }}
                        >
                          <Plus size={10} /> Adicionar
                        </button>
                      </div>
                      {v.attributes.length === 0 ? (
                        <div style={{ font: "11px var(--sans)", color: "var(--faint)" }}>Nenhum atributo</div>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                          {v.attributes.map((attr, attrIdx) => (
                            <div key={attrIdx} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: 8, alignItems: "start" }}>
                              <input
                                value={attr.key}
                                onChange={(e) => updateAttribute(idx, attrIdx, { key: e.target.value })}
                                placeholder="Ex: Cor"
                                style={{ padding: "6px 8px", borderRadius: 4, border: "1px solid var(--border)", font: "11px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--card)" }}
                              />
                              <input
                                value={attr.value}
                                onChange={(e) => updateAttribute(idx, attrIdx, { value: e.target.value })}
                                placeholder="Ex: Preto"
                                style={{ padding: "6px 8px", borderRadius: 4, border: "1px solid var(--border)", font: "11px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--card)" }}
                              />
                              <button
                                type="button"
                                onClick={() => removeAttribute(idx, attrIdx)}
                                aria-label="Remover atributo"
                                style={{ padding: "4px 6px", borderRadius: 4, border: "1px solid var(--danger)", background: "var(--danger-soft)", color: "var(--danger)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", font: "600 10px var(--sans)" }}
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