import React, { useState } from "react";
import { FolderTree, Pencil, Plus, Trash2 } from "lucide-react";
import type { MerchantProfile } from "../api-client.js";

export interface CategoryDraft {
  id: string;
  name: string;
  slug: string;
  parentId: string | null;
}

export interface CategoriesPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

export function slugify(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function CategoriesPage(props: CategoriesPageProps) {
  const [categories, setCategories] = useState<CategoryDraft[]>([]);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [parentId, setParentId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function resetForm() {
    setName("");
    setSlug("");
    setParentId("");
    setEditingId(null);
  }

  function addOrUpdate() {
    setError(null);
    const trimmedName = name.trim();
    const trimmedSlug = (slug || slugify(trimmedName)).trim();
    if (!trimmedName) {
      setError("Informe um nome");
      return;
    }
    if (!trimmedSlug) {
      setError("Slug inválido");
      return;
    }
    if (editingId) {
      setCategories((prev) =>
        prev.map((c) =>
          c.id === editingId
            ? { ...c, name: trimmedName, slug: trimmedSlug, parentId: parentId || null }
            : c,
        ),
      );
    } else {
      const id = `cat_${Date.now().toString(36)}`;
      setCategories((prev) => [
        ...prev,
        { id, name: trimmedName, slug: trimmedSlug, parentId: parentId || null },
      ]);
    }
    resetForm();
  }

  function startEdit(cat: CategoryDraft) {
    setEditingId(cat.id);
    setName(cat.name);
    setSlug(cat.slug);
    setParentId(cat.parentId ?? "");
  }

  function remove(id: string) {
    setCategories((prev) => prev.filter((c) => c.id !== id && c.parentId !== id));
    if (editingId === id) resetForm();
  }

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <h1>Categorias</h1>
          <p className="page-lead">Login necessário.</p>
        </div>
      </header>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>LOJA</div>
        <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Categorias</h1>
        <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Organize seus produtos por categorias.</div>
      </div>

      <div style={{ padding: "12px 16px", borderRadius: 8, background: "var(--warn-soft)", border: "1px solid var(--warn)", font: "13px var(--sans)", color: "var(--ink)", marginBottom: 16 }}>
        API de categorias em breve. Por enquanto, organize-as localmente — quando o backend estiver disponível, elas serão sincronizadas automaticamente.
      </div>

      <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: "20px 22px", marginBottom: 16 }}>
        <h3 style={{ font: "600 12px var(--mono)", color: "var(--faint)", letterSpacing: "0.05em", marginBottom: 14 }}>{editingId ? "EDITAR CATEGORIA" : "NOVA CATEGORIA"}</h3>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: 12, alignItems: "end" }}>
          <label>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Nome</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ex: Camisetas"
              style={{ width: "100%", padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border)", font: "13px var(--sans)", color: "var(--ink)", background: "var(--bg)", outline: "none" }}
            />
          </label>
          <label>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Slug</span>
            <input
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="camisetas"
              style={{ width: "100%", padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border)", font: "13px var(--mono)", color: "var(--ink)", background: "var(--bg)", outline: "none" }}
            />
          </label>
          <label>
            <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>Categoria pai (opcional)</span>
            <select
              value={parentId}
              onChange={(e) => setParentId(e.target.value)}
              style={{ width: "100%", padding: "8px 12px", borderRadius: 7, border: "1px solid var(--border)", font: "13px var(--sans)", color: "var(--ink)", background: "var(--bg)", outline: "none" }}
            >
              <option value="">— Nenhuma —</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={addOrUpdate}
            style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "8px 14px", borderRadius: 8, border: "1px solid var(--accent-dark)", background: "var(--accent-dark)", color: "white", cursor: "pointer", font: "600 12.5px var(--sans)" }}
          >
            <Plus size={12} /> {editingId ? "Atualizar" : "Adicionar"}
          </button>
        </div>
        {error ? (
          <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 6, background: "var(--danger-soft)", border: "1px solid var(--danger)", font: "12px var(--sans)", color: "var(--danger)" }}>
            {error}
          </div>
        ) : null}
      </section>

      <section style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
        {categories.length === 0 ? (
          <div style={{ padding: "40px 22px", textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 8, color: "var(--faint)" }}>
            <FolderTree size={32} />
            <strong style={{ font: "600 13px var(--sans)", color: "var(--ink)" }}>Nenhuma categoria criada.</strong>
            <p style={{ font: "12.5px var(--sans)", color: "var(--faint)" }}>Use o formulário acima para criar a primeira.</p>
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["NOME", "SLUG", "PAI", ""].map((c) => (
                  <th key={c} style={{ textAlign: "left", padding: "10px 22px", font: "600 10.5px var(--mono)", letterSpacing: "0.05em", color: "var(--faint)", borderBottom: "1px solid var(--border)" }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {categories.map((c) => {
                const parent = categories.find((p) => p.id === c.parentId);
                return (
                  <tr key={c.id}>
                    <td style={{ padding: "12px 22px", font: "13px var(--sans)", color: "var(--ink)", borderBottom: "1px solid var(--border)" }}>{c.name}</td>
                    <td style={{ padding: "12px 22px", font: "13px var(--mono)", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{c.slug}</td>
                    <td style={{ padding: "12px 22px", font: "13px var(--sans)", color: "var(--muted)", borderBottom: "1px solid var(--border)" }}>{parent?.name ?? "—"}</td>
                    <td style={{ padding: "12px 22px", borderBottom: "1px solid var(--border)", textAlign: "right" }}>
                      <div style={{ display: "inline-flex", gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => startEdit(c)}
                          aria-label={`Editar ${c.name}`}
                          style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--card)", color: "var(--ink)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, font: "600 11.5px var(--sans)" }}
                        >
                          <Pencil size={12} /> Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(c.id)}
                          aria-label={`Remover ${c.name}`}
                          style={{ padding: "5px 9px", borderRadius: 6, border: "1px solid var(--danger)", background: "var(--danger-soft)", color: "var(--danger)", cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 4, font: "600 11.5px var(--sans)" }}
                        >
                          <Trash2 size={12} /> Remover
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}