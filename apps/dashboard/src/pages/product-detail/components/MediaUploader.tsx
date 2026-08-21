import React from "react";
import { Image as ImageIcon } from "lucide-react";
import { useApi } from "../../../hooks/useApi.js";
import { reportError } from "../../../hooks/useErrorReporter.js";
import type { ProductVariantDraft } from "../hooks/useVariantManager.js";

export interface MediaUploaderProps {
  merchantId: string;
  variants: ProductVariantDraft[];
  hasVariants: boolean;
  variantMedia: Record<string, Array<{ id: string; url: string }>>;
  uploadingVariant: string | null;
  onUploadingChange: (v: string | null) => void;
  onAddMedia: (variantId: string, media: { id: string; url: string }) => void;
  onRemoveMedia: (variantId: string, mediaId: string) => void;
  onUpdateVariant: (index: number, patch: Partial<ProductVariantDraft>) => void;
}

export function MediaUploader(props: MediaUploaderProps) {
  const {
    merchantId,
    variants,
    hasVariants,
    variantMedia,
    uploadingVariant,
    onUploadingChange,
    onAddMedia,
    onRemoveMedia,
    onUpdateVariant,
  } = props;
  const api = useApi();

  return (
    <section style={{ background: "var(--surface-2)", border: "1px solid var(--color-border)", borderRadius: 14, padding: "20px 22px" }}>
      <h3 style={{ font: "600 12px var(--font-mono)", color: "var(--color-text-faint)", letterSpacing: "0.05em", marginBottom: 14 }}>IMAGENS</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {variants.map((v, idx) => (
          <div key={idx} style={{ background: "var(--surface-1)", border: "1px solid var(--color-border)", borderRadius: 10, padding: "16px" }}>
            <div style={{ marginBottom: 12 }}>
              <strong style={{ font: "600 12px var(--font-sans)", color: "var(--color-text)" }}>
                {hasVariants ? `Variante #${idx + 1} — ${v.sku}` : "Imagens do produto"}
              </strong>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 10, marginBottom: 14 }}>
              {/* Existing media */}
              {(variantMedia[v.id!] || []).map((media) => (
                <div key={media.id} style={{ position: "relative", borderRadius: 8, overflow: "hidden", aspectRatio: "1", background: "var(--color-border)" }}>
                  <img src={media.url} alt="Produto" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button
                    type="button"
                    onClick={async () => {
                      onUploadingChange(v.id!);
                      try {
                        await api.deleteProductMedia?.(merchantId, media.id);
                        onRemoveMedia(v.id!, media.id);
                      } catch (e) {
                        reportError({ source: "MediaUploader.delete", error: e });
                      } finally {
                        onUploadingChange(null);
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
              {/* Pending images */}
              {(v.pendingImages || []).map((base64, imgIdx) => (
                <div key={`pending-${imgIdx}`} style={{ position: "relative", borderRadius: 8, overflow: "hidden", aspectRatio: "1", background: "var(--color-border)" }}>
                  <img src={base64} alt="Pendente" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.7 }} />
                  <div style={{ position: "absolute", bottom: 4, left: 4, padding: "2px 6px", borderRadius: 4, background: "rgba(0,0,0,0.7)", color: "#fff", fontSize: "9px", fontWeight: 600 }}>Pendente</div>
                  <button
                    type="button"
                    onClick={() => onUpdateVariant(idx, { pendingImages: v.pendingImages.filter((_, i) => i !== imgIdx) })}
                    aria-label="Remover imagem pendente"
                    style={{ position: "absolute", top: 4, right: 4, width: 22, height: 22, borderRadius: 4, background: "rgba(0,0,0,0.5)", border: "none", color: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", lineHeight: 1 }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              {/* Upload button */}
              <label style={{ borderRadius: 8, border: "2px dashed var(--color-border)", background: "var(--surface-1)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", aspectRatio: "1", cursor: (uploadingVariant === v.id || uploadingVariant === `pending-${idx}`) ? "not-allowed" : "pointer", opacity: (uploadingVariant === v.id || uploadingVariant === `pending-${idx}`) ? 0.6 : 1 }}>
                {(uploadingVariant === v.id || uploadingVariant === `pending-${idx}`) ? (
                  <>
                    <div style={{ width: 20, height: 20, border: "2px solid var(--color-text-faint)", borderTopColor: "var(--color-brand-hover)", borderRadius: "50%", animation: "spin 0.8s linear infinite", marginBottom: 4 }} />
                    <span style={{ font: "11px var(--font-sans)", color: "var(--color-brand-hover)", textAlign: "center" }}>Enviando...</span>
                  </>
                ) : (
                  <>
                    <ImageIcon size={24} style={{ color: "var(--color-text-faint)", marginBottom: 4 }} />
                    <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)", textAlign: "center" }}>Upload</span>
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.currentTarget.files?.[0];
                    if (!file || !merchantId) return;
                    onUploadingChange(v.id || `pending-${idx}`);
                    try {
                      const reader = new FileReader();
                      reader.onload = async (re) => {
                        try {
                          const base64 = re.target?.result as string;
                          if (v.id) {
                            const result = await api.uploadProductMedia?.(merchantId, v.id, base64);
                            if (result) {
                              onAddMedia(v.id!, { id: result.id, url: result.url });
                            }
                          } else {
                            onUpdateVariant(idx, {
                              pendingImages: [...(variants[idx]?.pendingImages || []), base64],
                            });
                          }
                        } catch (e) {
                          reportError({ source: "MediaUploader.upload", error: e });
                        } finally {
                          onUploadingChange(null);
                        }
                      };
                      reader.readAsDataURL(file);
                    } catch (err) {
                      onUploadingChange(null);
                      reportError({ source: "MediaUploader.readFile", error: err });
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
  );
}
