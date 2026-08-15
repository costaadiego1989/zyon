import React, { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import type { ProductCategoryDTO, CreateCategoryInput, UpdateCategoryInput } from "../../../api/endpoints/catalog.js";
import { slugify } from "../useCategoriesPage.js";

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
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (mode === "edit" && category) {
      setName(category.name);
      setSlug(category.slug);
      setParentId(category.parent_id ?? "");
      setDescription(category.description ?? "");
      setImageUrl(category.image_url ?? "");
    } else {
      setName("");
      setSlug("");
      setParentId(defaultParentId ?? "");
      setDescription("");
      setImageUrl("");
    }
    setError(null);
  }, [mode, category, defaultParentId]);

  const handleNameChange = useCallback((value: string) => {
    setName(value);
    if (!slug) {
      setSlug(slugify(value));
    }
  }, [slug]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);

      const trimmedName = name.trim();
      const trimmedSlug = slug.trim();
      const trimmedDescription = description.trim();

      if (!trimmedName) {
        setError("Nome é obrigatório");
        return;
      }
      if (!trimmedSlug) {
        setError("Slug é obrigatório");
        return;
      }

      const data = {
        name: trimmedName,
        slug: trimmedSlug,
        parent_id: parentId || undefined,
        description: trimmedDescription || undefined,
        image_url: imageUrl || undefined,
      };

      onSave(data);
    },
    [name, slug, description, imageUrl, parentId, onSave],
  );

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
        boxShadow: "-4px 0 12px rgba(0,0,0,0.15)",
        zIndex: 1000,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
        <h2 style={{ font: "600 15px var(--serif)", color: "var(--ink)", margin: 0 }}>
          {mode === "edit" ? "Editar categoria" : "Nova categoria"}
        </h2>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg)", cursor: saving ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--faint)" }}
        >
          <X size={14} />
        </button>
      </div>

      <form onSubmit={handleSubmit} style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ flex: 1, overflowY: "auto", padding: "20px" }}>
          {error ? (
            <div style={{ padding: "8px 12px", borderRadius: 6, background: "var(--danger-soft)", border: "1px solid var(--danger)", font: "12px var(--sans)", color: "var(--danger)", marginBottom: 16 }}>
              {error}
            </div>
          ) : null}

          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>Nome *</span>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Ex: Camisetas"
              disabled={saving}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                font: "13px var(--sans)",
                color: "var(--ink)",
                background: "var(--bg)",
                outline: "none",
              }}
            />
          </label>

          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>Slug *</span>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="camisetas"
              disabled={saving}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                font: "13px var(--mono)",
                color: "var(--ink)",
                background: "var(--bg)",
                outline: "none",
              }}
            />
          </label>

          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>Categoria pai (opcional)</span>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              disabled={saving}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                font: "13px var(--sans)",
                color: "var(--ink)",
                background: "var(--bg)",
                outline: "none",
              }}
            >
              <option value="">— Nenhuma —</option>
              {parentOptions.map((cat) => (
                <option key={cat.id} value={cat.id}>{cat.name}</option>
              ))}
            </select>
          </label>

          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>Descrição (opcional)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva esta categoria..."
              disabled={saving}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                font: "13px var(--sans)",
                color: "var(--ink)",
                background: "var(--bg)",
                outline: "none",
                minHeight: 80,
                resize: "none",
              }}
            />
          </label>

          <label style={{ display: "block", marginBottom: 16 }}>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 6 }}>URL da imagem (opcional)</span>
            <input
              type="url"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://..."
              disabled={saving}
              style={{
                width: "100%",
                padding: "8px 12px",
                borderRadius: 7,
                border: "1px solid var(--border)",
                font: "13px var(--sans)",
                color: "var(--ink)",
                background: "var(--bg)",
                outline: "none",
              }}
            />
          </label>
        </div>

        <div style={{ padding: "16px 20px", borderTop: "1px solid var(--border)", display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            style={{
              flex: 1,
              padding: "8px 14px",
              borderRadius: 7,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--ink)",
              cursor: saving ? "not-allowed" : "pointer",
              font: "600 12px var(--sans)",
              opacity: saving ? 0.6 : 1,
            }}
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            style={{
              flex: 1,
              padding: "8px 14px",
              borderRadius: 7,
              border: "1px solid var(--accent-dark)",
              background: "var(--accent-dark)",
              color: "white",
              cursor: saving ? "not-allowed" : "pointer",
              font: "600 12px var(--sans)",
              opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}
