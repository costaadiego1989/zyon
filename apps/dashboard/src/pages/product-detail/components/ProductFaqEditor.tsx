"use client";

import React, { useCallback, useState } from "react";
import { GripVertical, Pencil, Trash2, Plus, Save, X } from "lucide-react";
import { Button } from "../../../components/Button.js";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import { showToast } from "../../../components/Toast.js";
import type { ProductFaq } from "../../../api/endpoints/product-content.js";

export interface ProductFaqEditorProps {
  faqs: ProductFaq[];
  busy?: boolean;
  onSave: (faq: ProductFaq) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onReorder: (orderedIds: string[]) => Promise<void>;
}

interface FaqFormState {
  id?: string;
  question: string;
  answer: string;
  isPublished: boolean;
}

const EMPTY_FORM: FaqFormState = { question: "", answer: "", isPublished: true };

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  borderRadius: 6,
  border: "1px solid var(--color-border)",
  font: "12.5px var(--font-sans)",
  color: "var(--color-text)",
  outline: "none",
  background: "var(--surface-1)",
};

const labelStyle: React.CSSProperties = {
  font: "600 11px var(--font-sans)",
  color: "var(--color-text-muted)",
  display: "block",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

export function ProductFaqEditor({ faqs, busy = false, onSave, onDelete, onReorder }: ProductFaqEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FaqFormState>(EMPTY_FORM);
  const [dragId, setDragId] = useState<string | null>(null);

  const isEditing = editingId !== null;

  const handleStartEdit = useCallback((faq: ProductFaq) => {
    setEditingId(faq.id);
    setForm({ id: faq.id, question: faq.question, answer: faq.answer, isPublished: faq.isPublished });
  }, []);

  const handleCancel = useCallback(() => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }, []);

  const handleAddNew = useCallback(() => {
    setEditingId("__new__");
    setForm(EMPTY_FORM);
  }, []);

  const handleSave = useCallback(async () => {
    if (!form.question.trim() || !form.answer.trim()) {
      showToast("error", "Pergunta e resposta são obrigatórias");
      return;
    }
    try {
      const existing = faqs.find((f) => f.id === form.id);
      const payload: ProductFaq = {
        id: form.id ?? crypto.randomUUID(),
        productId: existing?.productId ?? "",
        question: form.question.trim(),
        answer: form.answer.trim(),
        order: existing?.order ?? 0,
        isPublished: form.isPublished,
      };
      await onSave(payload);
      handleCancel();
    } catch {
      // toast handled by parent
    }
  }, [form, faqs, onSave, handleCancel]);

  const handleDelete = useCallback(
    async (id: string) => {
      if (typeof window !== "undefined" && !window.confirm("Remover este FAQ?")) return;
      try {
        await onDelete(id);
      } catch {
        // toast handled by parent
      }
    },
    [onDelete],
  );

  const handleDragStart = useCallback((id: string) => setDragId(id), []);
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => e.preventDefault(), []);
  const handleDrop = useCallback(
    async (targetId: string) => {
      if (!dragId || dragId === targetId) {
        setDragId(null);
        return;
      }
      const ids = faqs.map((f) => f.id);
      const from = ids.indexOf(dragId);
      const to = ids.indexOf(targetId);
      if (from < 0 || to < 0) {
        setDragId(null);
        return;
      }
      const next = [...ids];
      const [picked] = next.splice(from, 1);
      next.splice(to, 0, picked);
      try {
        await onReorder(next);
      } catch {
        // toast handled by parent
      }
      setDragId(null);
    },
    [dragId, faqs, onReorder],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-faint)", letterSpacing: "0.05em" }}>
          {faqs.length} FAQ{faqs.length === 1 ? "" : "S"}
        </div>
        <Button variant="outline" size="sm" onClick={handleAddNew} disabled={busy || isEditing}>
          <Plus size={13} /> Adicionar FAQ
        </Button>
      </div>

      {isEditing ? (
        <div style={{ border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--surface-1)", padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <label>
            <span style={labelStyle}>Pergunta</span>
            <input
              style={inputStyle}
              value={form.question}
              disabled={busy}
              onChange={(e) => setForm((f) => ({ ...f, question: e.target.value }))}
            />
          </label>
          <label>
            <span style={labelStyle}>Resposta</span>
            <textarea
              style={{ ...inputStyle, minHeight: 90 }}
              value={form.answer}
              disabled={busy}
              onChange={(e) => setForm((f) => ({ ...f, answer: e.target.value }))}
            />
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={labelStyle}>Publicado</span>
            <ToggleSwitch
              checked={form.isPublished}
              disabled={busy}
              onChange={(v) => setForm((f) => ({ ...f, isPublished: v }))}
            />
            <span style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
              {form.isPublished ? "Visível na loja" : "Rascunho"}
            </span>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Button onClick={() => void handleSave()} disabled={busy}>
              <Save size={13} /> Salvar
            </Button>
            <Button variant="ghost" onClick={handleCancel} disabled={busy}>
              <X size={13} /> Cancelar
            </Button>
          </div>
        </div>
      ) : null}

      {faqs.length === 0 && !isEditing ? (
        <div style={{ border: "1px dashed var(--color-border)", borderRadius: 10, padding: "32px 16px", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>
          Nenhum FAQ ainda. Clique em "Adicionar FAQ".
        </div>
      ) : null}

      {faqs.map((faq) => (
        <div
          key={faq.id}
          draggable={!busy && !isEditing}
          onDragStart={() => handleDragStart(faq.id)}
          onDragOver={handleDragOver}
          onDrop={() => handleDrop(faq.id)}
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            background: "var(--surface-2)",
            padding: "10px 12px",
            display: "flex",
            gap: 10,
            alignItems: "flex-start",
          }}
        >
          <span style={{ color: "var(--color-text-muted)", display: "flex", alignItems: "center" }}>
            <GripVertical size={14} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>{faq.question}</div>
            <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 4, lineHeight: 1.5 }}>
              {faq.answer}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
              <span style={{ font: "10.5px var(--font-mono)", color: "var(--color-text-faint)", letterSpacing: "0.05em" }}>
                {faq.isPublished ? "PUBLICADO" : "RASCUNHO"}
              </span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button
              type="button"
              aria-label="Editar"
              disabled={busy || isEditing}
              onClick={() => handleStartEdit(faq)}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: 4 }}
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              aria-label="Excluir"
              disabled={busy}
              onClick={() => void handleDelete(faq.id)}
              style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-danger, #b91c1c)", padding: 4 }}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
