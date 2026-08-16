import React, { useCallback, useEffect, useRef, useState } from "react";
import { X, Upload, Image as ImageIcon } from "lucide-react";
import type { ProductCategoryDTO, CreateCategoryInput, UpdateCategoryInput } from "../../../api/endpoints/catalog.js";
import { slugify } from "../useCategoriesPage.js";
import { useApi } from "../../../hooks/useApi.js";
import { ModalButton } from "../../../components/ModalButton.js";

interface CategoryFormProps {
  mode: "create" | "edit";
  category: ProductCategoryDTO | null;
  parentOptions: ProductCategoryDTO[];
  defaultParentId?: string;
  saving: boolean;
  onSave: (data: CreateCategoryInput | UpdateCategoryInput) => void;
  onCancel: () => void;
}

export function CategoryForm({
  mode,
  category,
  parentOptions,
  defaultParentId,
  saving,
  onSave,
  onCancel,
}: CategoryFormProps) {
  const api = useApi();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [imagePreview, setImagePreview] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "edit" && category) {
      setName(category.name);
      setSlug(category.slug);
      setParentId(category.parent_id ?? "");
      setDescription(category.description ?? "");
      setImageUrl(category.image_url ?? "");
      setImagePreview(category.image_url ?? "");
    } else {
      setName("");
      setSlug("");
      setParentId(defaultParentId ?? "");
      setDescription("");
      setImageUrl("");
      setImagePreview("");
    }
    setError(null);
  }, [mode, category, defaultParentId]);

  const handleNameChange = useCallback((value: string) => {
    setName(value);
    if (mode === "create" && !slug) {
      setSlug(slugify(value));
    }
  }, [mode, slug]);

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      setImagePreview(base64);
      setUploading(true);
      try {
        const { logoUrl } = await api.uploadLogo(base64);
        setImageUrl(logoUrl);
      } catch {
        setImageUrl(base64);
      } finally {
        setUploading(false);
      }
    };
    reader.readAsDataURL(file);
  }

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      const trimmedName = name.trim();
      const trimmedSlug = slug.trim() || slugify(trimmedName);

      if (!trimmedName) {
        setError("Nome é obrigatório");
        return;
      }

      if (mode === "create") {
        const data: CreateCategoryInput = {
          name: trimmedName,
          slug: trimmedSlug,
          parent_id: parentId || undefined,
          description: description.trim() || undefined,
          image_url: imageUrl || undefined,
        };
        onSave(data);
      } else {
        const data: UpdateCategoryInput = {
          name: trimmedName,
          parent_id: parentId || null,
          description: description.trim() || undefined,
          image_url: imageUrl || undefined,
        };
        onSave(data);
      }
    },
    [name, slug, description, imageUrl, parentId, mode, onSave],
  );

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "9px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    font: "13px var(--sans)",
    color: "var(--ink)",
    background: "var(--bg)",
    outline: "none",
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        right: 0,
        bottom: 0,
        width: 420,
        background: "var(--card)",
        borderLeft: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        boxShadow: "-8px 0 24px rgba(0,0,0,0.2)",
        zIndex: 1000,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <h2 style={{ font: "600 15px var(--serif)", color: "var(--ink)", margin: 0 }}>
          {mode === "edit" ? `Editar: ${category?.name ?? ""}` : "Nova categoria"}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          aria-label="Fechar"
          style={{ width: 40, height: 40, borderRadius: 8, border: "1px solid var(--border)", background: "var(--card)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--ink)" }}
        >
          <X size={20} />
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "20px", display: "flex", flexDirection: "column", gap: 16 }}>
          {error && (
            <div style={{ padding: "8px 12px", borderRadius: 6, background: "var(--danger-soft)", border: "1px solid var(--danger)", font: "12px var(--sans)", color: "var(--danger)" }}>
              {error}
            </div>
          )}

          <label style={{ display: "block" }}>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>Nome *</span>
            <input type="text" value={name} onChange={(e) => handleNameChange(e.target.value)} placeholder="Ex: Camisetas" disabled={saving} style={inputStyle} />
          </label>

          <label style={{ display: "block" }}>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>Slug</span>
            <input type="text" value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="camisetas" disabled={saving} style={{ ...inputStyle, fontFamily: "var(--mono)" }} />
          </label>

          <label style={{ display: "block" }}>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>Categoria pai</span>
            <select value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={saving} style={inputStyle}>
              <option value="">— Nenhuma (raiz) —</option>
              {parentOptions.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </label>

          <label style={{ display: "block" }}>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>Descrição</span>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descreva esta categoria..." disabled={saving} rows={3} style={{ ...inputStyle, minHeight: 72, resize: "vertical" }} />
          </label>

          <div>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>Imagem</span>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleImageUpload} style={{ display: "none" }} />
            {imagePreview ? (
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <img src={imagePreview} alt="" style={{ width: 56, height: 56, borderRadius: 8, objectFit: "cover", border: "1px solid var(--border)" }} />
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <button type="button" onClick={() => fileRef.current?.click()} disabled={saving || uploading} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", color: "var(--ink)", cursor: "pointer", font: "600 11px var(--sans)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                    <Upload size={11} /> {uploading ? "Enviando..." : "Trocar"}
                  </button>
                  <button type="button" onClick={() => { setImageUrl(""); setImagePreview(""); }} style={{ padding: "5px 10px", borderRadius: 6, border: "1px solid var(--danger)", background: "transparent", color: "var(--danger)", cursor: "pointer", font: "600 11px var(--sans)" }}>
                    Remover
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={saving || uploading}
                style={{ width: "100%", padding: "20px", borderRadius: 8, border: "2px dashed var(--border)", background: "var(--bg)", color: "var(--faint)", cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", gap: 6, font: "12px var(--sans)" }}
              >
                <ImageIcon size={20} />
                {uploading ? "Enviando..." : "Clique para fazer upload"}
              </button>
            )}
          </div>
        </div>

        <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 12 }}>
          <ModalButton variant="secondary" onClick={onCancel} disabled={saving}>
            Cancelar
          </ModalButton>
          <ModalButton variant="primary" type="submit" disabled={saving || uploading} loading={saving} style={{ flex: 1 }}>
            {saving ? "Salvando..." : mode === "edit" ? "Atualizar" : "Criar categoria"}
          </ModalButton>
        </div>
      </form>
    </div>
  );
}
