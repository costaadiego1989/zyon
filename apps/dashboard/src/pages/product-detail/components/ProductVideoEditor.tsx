import React, { useCallback, useState } from "react";
import { Plus, Trash2, Clock, Image as ImageIcon } from "lucide-react";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import { Button } from "../../../components/Button.js";
import { TabBar } from "../../../components/TabBar.js";
import { showToast } from "../../../components/Toast.js";
import { EmptyState } from "../../../components/EmptyState.js";
import { ImageUploadField } from "./ImageUploadField.js";
import type { ProductVideo } from "../../../api/endpoints/product-content.js";

export interface ProductVideoEditorProps {
  videos: ProductVideo[];
  merchantId: string;
  busy?: boolean;
  onSave: (v: ProductVideo) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onModerate: (id: string, action: "approved" | "rejected", isPublished: boolean) => Promise<void>;
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  borderRadius: 8,
  border: "1px solid var(--color-border)",
  font: "13px var(--font-sans)",
  color: "var(--color-text)",
  outline: "none",
  background: "var(--surface-1)",
};

const labelSpanStyle: React.CSSProperties = {
  font: "600 12px var(--font-sans)",
  color: "var(--color-text)",
  display: "block",
  marginBottom: 4,
};

function segmentedStyle(active: boolean): React.CSSProperties {
  return {
    padding: "8px 10px",
    borderRadius: 8,
    border: `2px solid ${active ? "var(--color-brand-hover, var(--color-brand, #0f766e))" : "var(--color-border)"}`,
    background: active ? "var(--color-brand-subtle, color-mix(in oklch, var(--color-brand, #0f766e) 12%, transparent))" : "var(--surface-1)",
    color: active ? "var(--color-brand-hover, var(--color-brand, #0f766e))" : "var(--color-text)",
    font: "600 11px var(--font-sans)",
    cursor: "pointer",
  };
}

const TABS = [
  { key: "approved", label: "Publicados" },
  { key: "pending", label: "Moderar" },
];

const newVideo = (order: number): ProductVideo => ({
  id: crypto.randomUUID(),
  productId: "",
  title: "",
  videoUrl: "",
  source: "merchant",
  moderationStatus: "approved",
  isPublished: true,
  order,
});

const ALLOWED_HOSTS = ["youtube.com", "youtu.be", "vimeo.com", "player.vimeo.com"];

function isAllowedExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return false;
    return ALLOWED_HOSTS.some((host) => parsed.hostname.endsWith(host));
  } catch {
    return false;
  }
}

/**
 * Editor for per-product videos.
 *
 *  - URL input with provider allowlist (YouTube / Vimeo / MP4 direct).
 *  - Thumbnail reuses MediaUploader.
 *  - "Moderar" tab for customer-uploaded videos awaiting approval.
 */
export function ProductVideoEditor({
  videos,
  merchantId,
  busy,
  onSave,
  onDelete,
  onModerate,
}: ProductVideoEditorProps) {
  const [tab, setTab] = useState<string>("approved");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftSource, setDraftSource] = useState<"external" | "upload">("external");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftThumb, setDraftThumb] = useState("");

  const approved = videos.filter((v) => v.moderationStatus === "approved");
  const pending = videos.filter((v) => v.moderationStatus === "pending");

  const handleAdd = useCallback(async () => {
    const next = newVideo(videos.length);
    try {
      await onSave(next);
      setEditingId(next.id);
      setDraftTitle("");
      setDraftSource("external");
      setDraftUrl("");
      setDraftThumb("");
    } catch (e) {
      showToast("error", "Erro ao criar vídeo");
    }
  }, [onSave, videos.length]);

  const handleStartEdit = useCallback((v: ProductVideo) => {
    setEditingId(v.id);
    setDraftTitle(v.title);
    // Heuristic: if the URL is a public S3 / CDN we treat it as an upload,
    // otherwise it's an external embed.
    const looksLikeUpload =
      !isAllowedExternalUrl(v.videoUrl) ||
      /\.(mp4|webm|mov|m4v)(\?|$)/i.test(v.videoUrl);
    setDraftSource(looksLikeUpload ? "upload" : "external");
    setDraftUrl(v.videoUrl);
    setDraftThumb(v.thumbnailUrl ?? "");
  }, []);

  const handleCancel = useCallback(() => {
    setEditingId(null);
    setDraftTitle("");
    setDraftSource("external");
    setDraftUrl("");
    setDraftThumb("");
  }, []);

  const handleSave = useCallback(
    async (v: ProductVideo) => {
      if (!draftTitle.trim() || !draftUrl.trim()) {
        showToast("error", "Título e arquivo/URL do vídeo são obrigatórios");
        return;
      }
      if (draftSource === "external" && !isAllowedExternalUrl(draftUrl.trim())) {
        showToast("error", "URL deve ser YouTube, Vimeo ou MP4 direto");
        return;
      }
      try {
        await onSave({
          ...v,
          title: draftTitle.trim(),
          videoUrl: draftUrl.trim(),
          thumbnailUrl: draftThumb.trim() || null,
        });
        setEditingId(null);
      } catch (e) {
        showToast("error", e instanceof Error ? e.message : "Erro ao salvar vídeo");
      }
    },
    [draftThumb, draftTitle, draftUrl, draftSource, onSave],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      if (typeof window !== "undefined" && !window.confirm("Excluir este vídeo?")) return;
      try {
        await onDelete(id);
        if (editingId === id) handleCancel();
      } catch (e) {
        showToast("error", "Erro ao excluir vídeo");
      }
    },
    [editingId, handleCancel, onDelete],
  );

  const handleTogglePublished = useCallback(
    async (v: ProductVideo) => {
      try {
        await onSave({ ...v, isPublished: !v.isPublished });
      } catch (e) {
        showToast("error", "Erro ao atualizar vídeo");
      }
    },
    [onSave],
  );

  const handleModerate = useCallback(
    async (id: string, action: "approved" | "rejected") => {
      try {
        await onModerate(id, action, action === "approved");
        showToast("success", action === "approved" ? "Vídeo aprovado" : "Vídeo rejeitado");
      } catch (e) {
        showToast("error", "Erro ao moderar");
      }
    },
    [onModerate],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <TabBar tabs={TABS} activeTab={tab} onTabChange={setTab} />

      {tab === "approved" && (
        <>
          {approved.length === 0 && (
            <EmptyState
              title="Sem vídeos publicados"
              message="Adicione um vídeo para enriquecer a página do produto."
            />
          )}
          {approved.map((v) => {
            const isEditing = editingId === v.id;
            return (
              <div
                key={v.id}
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: 10,
                  background: "var(--surface-1)",
                  padding: 14,
                  display: "flex",
                  gap: 12,
                }}
              >
                {v.thumbnailUrl ? (
                  <img
                    src={v.thumbnailUrl}
                    alt={v.title}
                    style={{
                      width: 96,
                      height: 64,
                      objectFit: "cover",
                      borderRadius: 6,
                      flexShrink: 0,
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 96,
                      height: 64,
                      borderRadius: 6,
                      background: "var(--surface-2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: "var(--color-text-faint)",
                      flexShrink: 0,
                    }}
                  >
                    <ImageIcon size={20} />
                  </div>
                )}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                  {isEditing ? (
                    <>
                      <label>
                        <span style={labelSpanStyle}>Título</span>
                        <input
                          autoFocus
                          value={draftTitle}
                          onChange={(e) => setDraftTitle(e.target.value)}
                          style={inputStyle}
                          disabled={busy}
                        />
                      </label>
                      <div>
                        <span style={labelSpanStyle}>Fonte do vídeo</span>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 4 }}>
                          <button
                            type="button"
                            onClick={() => setDraftSource("external")}
                            style={segmentedStyle(draftSource === "external")}
                            disabled={busy}
                          >
                            URL externa
                          </button>
                          <button
                            type="button"
                            onClick={() => setDraftSource("upload")}
                            style={segmentedStyle(draftSource === "upload")}
                            disabled={busy}
                          >
                            Upload (S3)
                          </button>
                        </div>
                      </div>
                      {draftSource === "upload" ? (
                        <ImageUploadField
                          merchantId={merchantId}
                          productId={v.productId || "draft"}
                          value={draftUrl}
                          onChange={(next) => setDraftUrl(next)}
                          label="Arquivo do vídeo"
                          kind="video"
                          hidePreview
                          disabled={busy}
                        />
                      ) : (
                        <label>
                          <span style={labelSpanStyle}>URL (YouTube, Vimeo ou MP4)</span>
                          <input
                            value={draftUrl}
                            onChange={(e) => setDraftUrl(e.target.value)}
                            style={inputStyle}
                            placeholder="https://www.youtube.com/watch?v=..."
                            disabled={busy}
                          />
                        </label>
                      )}
                      <ImageUploadField
                        merchantId={merchantId}
                        productId={v.productId || "draft"}
                        value={draftThumb}
                        onChange={(next) => setDraftThumb(next)}
                        label="Thumbnail (opcional)"
                        hidePreview
                        disabled={busy}
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <Button variant="primary" size="sm" disabled={busy} onClick={() => void handleSave(v)}>
                          Salvar
                        </Button>
                        <Button variant="outline" size="sm" disabled={busy} onClick={handleCancel}>
                          Cancelar
                        </Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>
                        {v.title || <em style={{ color: "var(--color-text-faint)" }}>(sem título)</em>}
                      </div>
                      <a
                        href={v.videoUrl}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          font: "11px var(--font-mono)",
                          color: "var(--color-text-faint)",
                          textDecoration: "none",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {v.videoUrl}
                      </a>
                      <div style={{ display: "flex", gap: 10 }}>
                        <Button variant="outline" size="sm" onClick={() => handleStartEdit(v)} disabled={busy}>
                          Editar
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void handleDelete(v.id)} disabled={busy}>
                          <Trash2 size={13} /> Excluir
                        </Button>
                      </div>
                    </>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                  <ToggleSwitch
                    checked={v.isPublished}
                    onChange={() => void handleTogglePublished(v)}
                    disabled={busy}
                  />
                  <span style={{ font: "10px var(--font-mono)", color: "var(--color-text-faint)" }}>
                    {v.isPublished ? "PUBLICADO" : "RASCUNHO"}
                  </span>
                </div>
              </div>
            );
          })}

          <Button variant="primary" size="sm" onClick={() => void handleAdd()} disabled={busy}>
            <Plus size={13} /> Adicionar vídeo
          </Button>
        </>
      )}

      {tab === "pending" && (
        <>
          {pending.length === 0 ? (
            <EmptyState
              icon={<Clock size={20} />}
              title="Fila de moderação vazia"
              message="Vídeos enviados pelos clientes aparecerão aqui para aprovação."
            />
          ) : (
            pending.map((v) => (
              <div
                key={v.id}
                style={{
                  border: "1px solid var(--color-border)",
                  borderRadius: 10,
                  background: "var(--surface-1)",
                  padding: 14,
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>
                  {v.title || <em>(sem título)</em>}
                </div>
                <div style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)" }}>{v.videoUrl}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleModerate(v.id, "approved")}
                  >
                    Aprovar
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleModerate(v.id, "rejected")}
                  >
                    Rejeitar
                  </Button>
                </div>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
