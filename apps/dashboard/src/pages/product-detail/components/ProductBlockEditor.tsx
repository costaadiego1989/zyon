"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  Trash2,
  GripVertical,
  ChevronUp,
  ChevronDown,
  Heading2,
  Type as TypeIcon,
  List as ListIcon,
  Image as ImageIcon,
  Columns2,
  MessageSquare,
  Table,
  HelpCircle,
  Video as VideoIcon,
  GalleryHorizontal,
  Megaphone,
  MousePointerClick,
  Eye,
  EyeOff,
  Save,
} from "lucide-react";
import { Button } from "../../../components/Button.js";
import { showToast } from "../../../components/Toast.js";
import { EmptyState } from "../../../components/EmptyState.js";
import { ImageUploadField } from "./ImageUploadField.js";
import { ProductSearchDropdown } from "./ProductSearchDropdown.js";
import type {
  ProductContentBlock,
  ProductContentBlockType,
} from "../../../api/endpoints/product-content.js";

export interface ProductBlockEditorProps {
  initialBlocks: ProductContentBlock[];
  /** Pass an empty string while the product is being created — drafts live in-memory. */
  productId: string;
  /** Required for image / video upload-to-S3. Pass empty string in draft mode. */
  merchantId: string;
  onChange?: (blocks: ProductContentBlock[]) => void;
  /** When provided, the editor handles its own save (with optimistic + rollback handled at parent). */
  onSave?: (blocks: ProductContentBlock[]) => Promise<void>;
  readOnly?: boolean;
}

interface BlockTemplate {
  type: ProductContentBlockType;
  label: string;
  icon: React.ReactNode;
  defaults: () => Record<string, unknown>;
}

const BLOCK_TEMPLATES: BlockTemplate[] = [
  { type: "heading", label: "Título", icon: <Heading2 size={13} />, defaults: () => ({ level: 2, text: "" }) },
  { type: "paragraph", label: "Parágrafo", icon: <TypeIcon size={13} />, defaults: () => ({ text: "" }) },
  { type: "list", label: "Lista", icon: <ListIcon size={13} />, defaults: () => ({ style: "unordered", items: [""] }) },
  { type: "image", label: "Imagem", icon: <ImageIcon size={13} />, defaults: () => ({ src: "", alt: "", caption: "" }) },
  { type: "image_text_split", label: "Imagem + texto", icon: <Columns2 size={13} />, defaults: () => ({ imageSide: "left", imageSrc: "", imageAlt: "", text: "" }) },
  { type: "callout", label: "Destaque", icon: <MessageSquare size={13} />, defaults: () => ({ tone: "info", text: "" }) },
  { type: "table", label: "Tabela", icon: <Table size={13} />, defaults: () => ({ headers: ["Coluna 1"], rows: [["Linha 1"]] }) },
  { type: "faq", label: "FAQ (bloco)", icon: <HelpCircle size={13} />, defaults: () => ({ items: [{ question: "", answer: "" }] }) },
  { type: "video", label: "Vídeo", icon: <VideoIcon size={13} />, defaults: () => ({ provider: "youtube", ref: "" }) },
  { type: "carousel", label: "Carrossel", icon: <GalleryHorizontal size={13} />, defaults: () => ({ images: [{ src: "", alt: "" }] }) },
  { type: "banner", label: "Banner", icon: <Megaphone size={13} />, defaults: () => ({ imageSrc: "", alt: "", caption: "", linkUrl: "", ctaLabel: "" }) },
  { type: "button", label: "Botão", icon: <MousePointerClick size={13} />, defaults: () => ({ label: "Saiba mais", href: "https://", variant: "primary" }) },
];

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

function makeBlock(productId: string, type: ProductContentBlockType, order: number, overrides: Record<string, unknown> = {}): ProductContentBlock {
  const template = BLOCK_TEMPLATES.find((t) => t.type === type);
  return {
    id: crypto.randomUUID(),
    productId,
    type,
    props: { ...(template?.defaults() ?? {}), ...overrides },
    order,
    isEnabled: true,
  };
}

/**
 * Custom 12-block editor for Advanced Product Layout.
 *
 * The spec (T-APL-91) calls for a BlockNote-derived schema trimmed to our 12 types.
 * Rather than pull in BlockNote + TipTap (~400 KB gzip) we ship a focused in-house
 * editor that emits the exact same `ProductContentBlock[]` shape consumed by the
 * storefront renderer (`apps/storefront/src/components/blocks/ContentBlocks/types.ts`).
 * This keeps the editor bundle lean and avoids React 18/ProseMirror compat issues.
 *
 * Side panel: drag handle, add-block menu, save status indicator. Per-block
 * inline edit (toggle enabled, expand/collapse editor body, delete).
 */
export function ProductBlockEditor({ initialBlocks, productId, merchantId, onChange, onSave, readOnly = false }: ProductBlockEditorProps) {
  const [blocks, setBlocks] = useState<ProductContentBlock[]>(() =>
    [...(initialBlocks ?? [])]
      .map((b) => ({ ...b, props: { ...b.props } }))
      .sort((a, b) => a.order - b.order),
  );
  const [dragId, setDragId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [saving, setSaving] = useState(false);
  const dirtyRef = useRef(false);

  // Notify parent when blocks change (for parent-controlled save flow).
  useEffect(() => {
    if (dirtyRef.current) {
      onChange?.(blocks);
      dirtyRef.current = false;
    }
  }, [blocks, onChange]);

  // If the parent passes a new `initialBlocks` reference (e.g. after reload),
  // reset local state. We only re-sync on reference change to avoid clobbering
  // in-flight edits.
  const lastInitialRef = useRef(initialBlocks);
  useEffect(() => {
    if (lastInitialRef.current !== initialBlocks) {
      lastInitialRef.current = initialBlocks;
      setBlocks(
        [...(initialBlocks ?? [])]
          .map((b) => ({ ...b, props: { ...b.props } }))
          .sort((a, b) => a.order - b.order),
      );
    }
  }, [initialBlocks]);

  const updateBlocks = useCallback((updater: (prev: ProductContentBlock[]) => ProductContentBlock[]) => {
    dirtyRef.current = true;
    setBlocks(updater);
  }, []);

  const addBlock = useCallback(
    (type: ProductContentBlockType) => {
      updateBlocks((prev) => {
        const next = [...prev, makeBlock(productId, type, prev.length)];
        return next.map((b, idx) => ({ ...b, order: idx }));
      });
      setShowAddMenu(false);
    },
    [productId, updateBlocks],
  );

  const removeBlock = useCallback(
    (id: string) => {
      if (typeof window !== "undefined" && !window.confirm("Remover este bloco?")) return;
      updateBlocks((prev) => prev.filter((b) => b.id !== id).map((b, idx) => ({ ...b, order: idx })));
    },
    [updateBlocks],
  );

  const toggleEnabled = useCallback(
    (id: string) => {
      updateBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, isEnabled: !b.isEnabled } : b)));
    },
    [updateBlocks],
  );

  const moveBlock = useCallback(
    (id: string, direction: -1 | 1) => {
      updateBlocks((prev) => {
        const idx = prev.findIndex((b) => b.id === id);
        const target = idx + direction;
        if (idx < 0 || target < 0 || target >= prev.length) return prev;
        const next = [...prev];
        [next[idx], next[target]] = [next[target], next[idx]];
        return next.map((b, i) => ({ ...b, order: i }));
      });
    },
    [updateBlocks],
  );

  const handleDragStart = useCallback((id: string) => setDragId(id), []);
  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => e.preventDefault(), []);
  const handleDrop = useCallback(
    (targetId: string) => {
      if (!dragId || dragId === targetId) {
        setDragId(null);
        return;
      }
      updateBlocks((prev) => {
        const ids = prev.map((b) => b.id);
        const from = ids.indexOf(dragId);
        const to = ids.indexOf(targetId);
        if (from < 0 || to < 0) return prev;
        const next = [...prev];
        const [picked] = next.splice(from, 1);
        next.splice(to, 0, picked);
        return next.map((b, i) => ({ ...b, order: i }));
      });
      setDragId(null);
    },
    [dragId, updateBlocks],
  );

  const patchBlock = useCallback(
    (id: string, patch: Record<string, unknown>) => {
      updateBlocks((prev) =>
        prev.map((b) => (b.id === id ? { ...b, props: { ...b.props, ...patch } } : b)),
      );
    },
    [updateBlocks],
  );

  const handleSave = useCallback(async () => {
    if (!onSave) return;
    setSaving(true);
    try {
      await onSave(blocks);
      showToast("success", "Conteúdo salvo");
    } catch (e) {
      showToast("error", e instanceof Error ? e.message : "Erro ao salvar conteúdo");
    } finally {
      setSaving(false);
    }
  }, [blocks, onSave]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {blocks.length === 0 && (
        <EmptyState
          title="Sem blocos ainda"
          message="Clique em Adicionar bloco para montar a página do produto."
        />
      )}

      {blocks.map((block) => (
        <BlockRow
          key={block.id}
          block={block}
          expanded={expandedId === block.id}
          readOnly={readOnly}
          isDragging={dragId === block.id}
          merchantId={merchantId}
          productId={productId}
          onToggleExpand={() => setExpandedId((cur) => (cur === block.id ? null : block.id))}
          onDragStart={() => handleDragStart(block.id)}
          onDragOver={handleDragOver}
          onDrop={() => handleDrop(block.id)}
          onMoveUp={() => moveBlock(block.id, -1)}
          onMoveDown={() => moveBlock(block.id, 1)}
          onToggleEnabled={() => toggleEnabled(block.id)}
          onDelete={() => removeBlock(block.id)}
          onPatch={(patch) => patchBlock(block.id, patch)}
        />
      ))}

      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <Button variant="outline" size="sm" onClick={() => setShowAddMenu((v) => !v)} disabled={readOnly}>
          <Plus size={13} /> Adicionar bloco
        </Button>
        {onSave && (
          <Button variant="primary" size="sm" onClick={() => void handleSave()} disabled={saving || readOnly}>
            <Save size={13} /> {saving ? "Salvando..." : "Salvar"}
          </Button>
        )}
      </div>

      {showAddMenu && (
        <div
          style={{
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            background: "var(--surface-1)",
            padding: 10,
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 6,
          }}
        >
          {BLOCK_TEMPLATES.map((t) => (
            <button
              key={t.type}
              type="button"
              onClick={() => addBlock(t.type)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 10px",
                borderRadius: 6,
                border: "1px solid var(--color-border)",
                background: "var(--surface-2)",
                color: "var(--color-text)",
                cursor: "pointer",
                font: "12px var(--font-sans)",
                textAlign: "left",
              }}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface BlockRowProps {
  block: ProductContentBlock;
  expanded: boolean;
  readOnly: boolean;
  isDragging: boolean;
  onToggleExpand: () => void;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void;
  onDrop: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
  onPatch: (patch: Record<string, unknown>) => void;
  merchantId: string;
  productId: string;
}

function BlockRow({
  block,
  expanded,
  readOnly,
  isDragging,
  onToggleExpand,
  onDragStart,
  onDragOver,
  onDrop,
  onMoveUp,
  onMoveDown,
  onToggleEnabled,
  onDelete,
  onPatch,
  merchantId,
  productId,
}: BlockRowProps) {
  const template = BLOCK_TEMPLATES.find((t) => t.type === block.type);

  return (
    <div
      draggable={!readOnly}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 10,
        background: block.isEnabled ? "var(--surface-2)" : "var(--surface-1)",
        opacity: isDragging ? 0.5 : block.isEnabled ? 1 : 0.6,
        cursor: readOnly ? "default" : "grab",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "var(--surface-1)",
          borderBottom: expanded ? "1px solid var(--color-border)" : "none",
        }}
      >
        <span style={{ color: "var(--color-text-muted)", display: "flex" }}>
          <GripVertical size={14} />
        </span>
        <button
          type="button"
          onClick={onToggleExpand}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: "transparent",
            border: "none",
            cursor: "pointer",
            padding: 0,
            font: "600 12.5px var(--font-sans)",
            color: "var(--color-text)",
            flex: 1,
            textAlign: "left",
          }}
        >
          {template?.icon}
          {template?.label}
          <span style={{ color: "var(--color-text-faint)", fontWeight: 400 }}>· #{block.order + 1}</span>
        </button>
        <button
          type="button"
          aria-label={block.isEnabled ? "Ocultar bloco" : "Mostrar bloco"}
          onClick={onToggleEnabled}
          disabled={readOnly}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: 4 }}
        >
          {block.isEnabled ? <Eye size={13} /> : <EyeOff size={13} />}
        </button>
        <button
          type="button"
          aria-label="Mover para cima"
          onClick={onMoveUp}
          disabled={readOnly}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: 4 }}
        >
          <ChevronUp size={13} />
        </button>
        <button
          type="button"
          aria-label="Mover para baixo"
          onClick={onMoveDown}
          disabled={readOnly}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-text-muted)", padding: 4 }}
        >
          <ChevronDown size={13} />
        </button>
        <button
          type="button"
          aria-label="Excluir"
          onClick={onDelete}
          disabled={readOnly}
          style={{ background: "transparent", border: "none", cursor: "pointer", color: "var(--color-danger, #b91c1c)", padding: 4 }}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {expanded && (
        <div style={{ padding: 14 }}>
          <BlockFields
            type={block.type}
            props={block.props}
            readOnly={readOnly}
            onPatch={onPatch}
            merchantId={merchantId}
            productId={productId}
          />
        </div>
      )}
    </div>
  );
}

interface BlockFieldsProps {
  type: ProductContentBlockType;
  props: Record<string, unknown>;
  readOnly: boolean;
  onPatch: (patch: Record<string, unknown>) => void;
  merchantId: string;
  productId: string;
}

function BlockFields({ type, props, readOnly, onPatch, merchantId, productId }: BlockFieldsProps) {
  const patch = (key: string, value: unknown) => onPatch({ [key]: value });

  switch (type) {
    case "heading":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label>
            <span style={labelStyle}>Nível</span>
            <select
              style={inputStyle}
              value={String((props.level as number) ?? 2)}
              disabled={readOnly}
              onChange={(e) => patch("level", Number(e.target.value))}
            >
              <option value="2">H2</option>
              <option value="3">H3</option>
            </select>
          </label>
          <label>
            <span style={labelStyle}>Texto</span>
            <textarea
              style={{ ...inputStyle, minHeight: 60 }}
              value={String(props.text ?? "")}
              disabled={readOnly}
              onChange={(e) => patch("text", e.target.value)}
            />
          </label>
        </div>
      );
    case "paragraph":
      return (
        <label>
          <span style={labelStyle}>Texto</span>
          <textarea
            style={{ ...inputStyle, minHeight: 100 }}
            value={String(props.text ?? "")}
            disabled={readOnly}
            onChange={(e) => patch("text", e.target.value)}
          />
        </label>
      );
    case "list": {
      const items = Array.isArray(props.items) ? (props.items as string[]) : [""];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label>
            <span style={labelStyle}>Estilo</span>
            <select
              style={inputStyle}
              value={String(props.style ?? "unordered")}
              disabled={readOnly}
              onChange={(e) => patch("style", e.target.value)}
            >
              <option value="unordered">Não ordenada</option>
              <option value="ordered">Ordenada</option>
            </select>
          </label>
          <div>
            <span style={labelStyle}>Itens</span>
            {items.map((it, idx) => (
              <input
                key={idx}
                style={{ ...inputStyle, marginBottom: 6 }}
                value={it}
                disabled={readOnly}
                onChange={(e) => {
                  const next = [...items];
                  next[idx] = e.target.value;
                  patch("items", next);
                }}
              />
            ))}
            <Button variant="ghost" size="sm" disabled={readOnly} onClick={() => patch("items", [...items, ""])}>
              + Item
            </Button>
          </div>
        </div>
      );
    }
    case "image":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <ImageUploadField
            merchantId={merchantId}
            productId={productId}
            value={String(props.src ?? "")}
            onChange={(v) => patch("src", v)}
            label="Imagem"
            disabled={readOnly}
          />
          <FieldText label="Texto alternativo (alt)" value={String(props.alt ?? "")} onChange={(v) => patch("alt", v)} readOnly={readOnly} />
          <FieldText label="Legenda (opcional)" value={String(props.caption ?? "")} onChange={(v) => patch("caption", v)} readOnly={readOnly} />
        </div>
      );
    case "image_text_split":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label>
            <span style={labelStyle}>Lado da imagem</span>
            <select
              style={inputStyle}
              value={String(props.imageSide ?? "left")}
              disabled={readOnly}
              onChange={(e) => patch("imageSide", e.target.value)}
            >
              <option value="left">Esquerda</option>
              <option value="right">Direita</option>
            </select>
          </label>
          <ImageUploadField
            merchantId={merchantId}
            productId={productId}
            value={String(props.imageSrc ?? "")}
            onChange={(v) => patch("imageSrc", v)}
            label="Imagem"
            disabled={readOnly}
          />
          <FieldText label="Texto alternativo" value={String(props.imageAlt ?? "")} onChange={(v) => patch("imageAlt", v)} readOnly={readOnly} />
          <FieldText label="Texto" value={String(props.text ?? "")} onChange={(v) => patch("text", v)} readOnly={readOnly} multi />
        </div>
      );
    case "callout":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label>
            <span style={labelStyle}>Tom</span>
            <select
              style={inputStyle}
              value={String(props.tone ?? "info")}
              disabled={readOnly}
              onChange={(e) => patch("tone", e.target.value)}
            >
              <option value="info">Informativo</option>
              <option value="success">Sucesso</option>
              <option value="warn">Atenção</option>
              <option value="danger">Crítico</option>
            </select>
          </label>
          <FieldText label="Título (opcional)" value={String(props.title ?? "")} onChange={(v) => patch("title", v)} readOnly={readOnly} />
          <FieldText label="Texto" value={String(props.text ?? "")} onChange={(v) => patch("text", v)} readOnly={readOnly} multi />
        </div>
      );
    case "table": {
      const headers = Array.isArray(props.headers) ? (props.headers as string[]) : [""];
      const rows = Array.isArray(props.rows) ? (props.rows as string[][]) : [[""]];
      const updateHeaders = (next: string[]) => patch("headers", next);
      const updateRows = (next: string[][]) => patch("rows", next);
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <FieldText label="Legenda" value={String(props.caption ?? "")} onChange={(v) => patch("caption", v)} readOnly={readOnly} />
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={labelStyle}>Cabeçalhos</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={readOnly}
                onClick={() => updateHeaders([...headers, `Coluna ${headers.length + 1}`])}
              >
                + Coluna
              </Button>
            </div>
            {headers.map((h, idx) => (
              <div key={idx} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  value={h}
                  disabled={readOnly}
                  onChange={(e) => {
                    const next = [...headers];
                    next[idx] = e.target.value;
                    updateHeaders(next);
                  }}
                />
                <button
                  type="button"
                  aria-label="Remover coluna"
                  disabled={readOnly || headers.length <= 1}
                  onClick={() => {
                    if (headers.length <= 1) return;
                    const nextHeaders = headers.filter((_, i) => i !== idx);
                    // Keep row width consistent: drop the matching cell from every row
                    const nextRows = rows.map((r) => r.filter((_, i) => i !== idx));
                    updateHeaders(nextHeaders);
                    updateRows(nextRows);
                  }}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--color-border)",
                    borderRadius: 6,
                    cursor: readOnly || headers.length <= 1 ? "not-allowed" : "pointer",
                    color: "var(--color-danger, #b91c1c)",
                    padding: "0 8px",
                    opacity: readOnly || headers.length <= 1 ? 0.45 : 1,
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={labelStyle}>Linhas</span>
              <Button
                variant="ghost"
                size="sm"
                disabled={readOnly}
                onClick={() => {
                  const next = [...rows, headers.map(() => "")];
                  updateRows(next);
                }}
              >
                + Linha
              </Button>
            </div>
            {rows.map((row, rIdx) => (
              <div key={rIdx} style={{ display: "flex", gap: 4, marginBottom: 4 }}>
                {row.map((cell, cIdx) => (
                  <input
                    key={cIdx}
                    style={{ ...inputStyle, flex: 1 }}
                    value={cell}
                    disabled={readOnly}
                    onChange={(e) => {
                      const next = rows.map((r) => [...r]);
                      next[rIdx][cIdx] = e.target.value;
                      updateRows(next);
                    }}
                  />
                ))}
                <button
                  type="button"
                  aria-label="Remover linha"
                  disabled={readOnly || rows.length <= 1}
                  onClick={() => {
                    if (rows.length <= 1) return;
                    const next = rows.filter((_, i) => i !== rIdx);
                    updateRows(next);
                  }}
                  style={{
                    background: "transparent",
                    border: "1px solid var(--color-border)",
                    borderRadius: 6,
                    cursor: readOnly || rows.length <= 1 ? "not-allowed" : "pointer",
                    color: "var(--color-danger, #b91c1c)",
                    padding: "0 8px",
                    opacity: readOnly || rows.length <= 1 ? 0.45 : 1,
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
      );
    }
    case "faq": {
      const items = Array.isArray(props.items)
        ? (props.items as Array<{ question: string; answer: string }>)
        : [{ question: "", answer: "" }];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={labelStyle}>Itens de FAQ</span>
          {items.map((it, idx) => (
            <div key={idx} style={{ border: "1px solid var(--color-border)", borderRadius: 6, padding: 8 }}>
              <FieldText
                label="Pergunta"
                value={it.question}
                onChange={(v) => {
                  const next = [...items];
                  next[idx] = { ...next[idx], question: v };
                  patch("items", next);
                }}
                readOnly={readOnly}
              />
              <FieldText
                label="Resposta"
                value={it.answer}
                onChange={(v) => {
                  const next = [...items];
                  next[idx] = { ...next[idx], answer: v };
                  patch("items", next);
                }}
                readOnly={readOnly}
                multi
              />
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            disabled={readOnly}
            onClick={() => patch("items", [...items, { question: "", answer: "" }])}
          >
            + Item
          </Button>
        </div>
      );
    }
    case "video":
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <label>
            <span style={labelStyle}>Provedor</span>
            <select
              style={inputStyle}
              value={String(props.provider ?? "youtube")}
              disabled={readOnly}
              onChange={(e) => patch("provider", e.target.value)}
            >
              <option value="youtube">YouTube</option>
              <option value="vimeo">Vimeo</option>
              <option value="mp4">MP4 direto</option>
            </select>
          </label>
          {props.provider === "mp4" ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <ImageUploadField
                merchantId={merchantId}
                productId={productId}
                value={String(props.ref ?? "")}
                onChange={(v) => patch("ref", v)}
                label="Arquivo MP4"
                kind="video"
                hidePreview
                disabled={readOnly}
              />
            </div>
          ) : (
            <FieldText
              label="ID ou URL do vídeo"
              value={String(props.ref ?? "")}
              onChange={(v) => patch("ref", v)}
              readOnly={readOnly}
            />
          )}
          <FieldText label="Legenda (opcional)" value={String(props.caption ?? "")} onChange={(v) => patch("caption", v)} readOnly={readOnly} />
        </div>
      );
    case "carousel": {
      const images = Array.isArray(props.images)
        ? (props.images as Array<{ src: string; alt: string }>)
        : [{ src: "", alt: "" }];
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={labelStyle}>Imagens</span>
          {images.map((img, idx) => (
            <div key={idx} style={{ border: "1px solid var(--color-border)", borderRadius: 6, padding: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              <ImageUploadField
                merchantId={merchantId}
                productId={productId}
                value={img.src}
                onChange={(v) => {
                  const next = [...images];
                  next[idx] = { ...next[idx], src: v };
                  patch("images", next);
                }}
                label={`Imagem ${idx + 1}`}
                hidePreview
                disabled={readOnly}
              />
              <FieldText
                label="Texto alternativo"
                value={img.alt}
                onChange={(v) => {
                  const next = [...images];
                  next[idx] = { ...next[idx], alt: v };
                  patch("images", next);
                }}
                readOnly={readOnly}
              />
            </div>
          ))}
          <Button
            variant="ghost"
            size="sm"
            disabled={readOnly}
            onClick={() => patch("images", [...images, { src: "", alt: "" }])}
          >
            + Imagem
          </Button>
          <FieldText label="Legenda (opcional)" value={String(props.caption ?? "")} onChange={(v) => patch("caption", v)} readOnly={readOnly} />
        </div>
      );
    }
    case "banner": {
      const addsCurrentProduct = props.ctaAction === "add_to_cart";
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <ImageUploadField
            merchantId={merchantId}
            productId={productId}
            value={String(props.imageSrc ?? "")}
            onChange={(v) => patch("imageSrc", v)}
            label="Imagem"
            disabled={readOnly}
          />
          <FieldText label="Texto alternativo" value={String(props.alt ?? "")} onChange={(v) => patch("alt", v)} readOnly={readOnly} />
          <FieldText label="Legenda" value={String(props.caption ?? "")} onChange={(v) => patch("caption", v)} readOnly={readOnly} />
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              checked={addsCurrentProduct}
              disabled={readOnly}
              onChange={(e) => onPatch({ ctaAction: e.target.checked ? "add_to_cart" : undefined, linkUrl: e.target.checked ? undefined : props.linkUrl })}
              style={{ accentColor: "var(--color-brand, #0f766e)" }}
            />
            <span style={labelStyle}>Adicionar este produto ao carrinho</span>
          </label>
          {!addsCurrentProduct ? <FieldText label="URL do link" value={String(props.linkUrl ?? "")} onChange={(v) => patch("linkUrl", v)} readOnly={readOnly} /> : null}
          <FieldText label="Rótulo do CTA" value={String(props.ctaLabel ?? "")} onChange={(v) => patch("ctaLabel", v)} readOnly={readOnly} />
        </div>
      );
    }
    case "button": {
      const linkType = (props.linkType as string) ?? "external";
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <FieldText label="Rótulo" value={String(props.label ?? "")} onChange={(v) => patch("label", v)} readOnly={readOnly} />
          <label>
            <span style={labelStyle}>Ação do botão</span>
            <select style={inputStyle} value={linkType} disabled={readOnly} onChange={(e) => patch("linkType", e.target.value)}>
              <option value="external">Abrir URL</option>
              <option value="product">Ver outro produto</option>
              <option value="add_to_cart">Adicionar este produto ao carrinho</option>
            </select>
          </label>
          {linkType === "product" ? (
            <ProductSearchDropdown
              merchantId={merchantId}
              excludeProductId={productId}
              value={String(props.productId ?? "")}
              onChange={(v) => patch("productId", v)}
              disabled={readOnly}
            />
          ) : linkType === "external" ? (
            <FieldText label="URL" value={String(props.href ?? "")} onChange={(v) => patch("href", v)} readOnly={readOnly} />
          ) : null}
          <label>
            <span style={labelStyle}>Variante</span>
            <select
              style={inputStyle}
              value={String(props.variant ?? "primary")}
              disabled={readOnly}
              onChange={(e) => patch("variant", e.target.value)}
            >
              <option value="primary">Primário</option>
              <option value="secondary">Secundário</option>
            </select>
          </label>
        </div>
      );
    }
    default:
      return null;
  }
}

function FieldText({
  label,
  value,
  onChange,
  readOnly,
  multi,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  readOnly?: boolean;
  multi?: boolean;
}) {
  return (
    <label>
      <span style={labelStyle}>{label}</span>
      {multi ? (
        <textarea
          style={{ ...inputStyle, minHeight: 70 }}
          value={value}
          disabled={readOnly}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input style={inputStyle} value={value} disabled={readOnly} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  );
}
