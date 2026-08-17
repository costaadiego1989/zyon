import React, { useCallback, useRef, useState } from "react";
import { Upload, Trash2, Loader2 } from "lucide-react";
import { useApi } from "../hooks/useApi.js";

export interface ImageUploaderProps {
  label: string;
  hint?: string;
  value?: string;
  onChange: (url: string | undefined) => void;
  folder?: string;
  previewSize?: number;
  previewRound?: boolean;
  accept?: string;
  deletable?: boolean;
}

export function ImageUploader({
  label,
  hint,
  value,
  onChange,
  folder,
  previewSize = 80,
  previewRound = false,
  accept = "image/*",
  deletable = true,
}: ImageUploaderProps) {
  const api = useApi();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Arquivo deve ser uma imagem");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Imagem deve ter no máximo 5MB");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const base64 = await fileToBase64(file);
      onChange(base64);
      const result = await api.uploadLogo(base64);
      if (result?.logoUrl) onChange(result.logoUrl);
    } catch {
      setError("Falha no upload. Tente novamente.");
    } finally {
      setUploading(false);
    }
  }, [api, onChange]);

  const handleDelete = useCallback(async () => {
    if (!value || !deletable) return;
    setDeleting(true);
    setError(null);
    try {
      if (value.startsWith("http")) {
        await api.deleteStorageObject(value);
      }
      onChange(undefined);
    } catch {
      onChange(undefined);
    } finally {
      setDeleting(false);
    }
  }, [value, api, onChange, deletable]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) void handleFile(file);
  }, [handleFile]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    if (inputRef.current) inputRef.current.value = "";
  }, [handleFile]);

  const hasImage = !!value;
  const radius = previewRound ? "50%" : "10px";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg)" }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: "var(--faint)" }}>· {hint}</span>}
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "10px 14px",
          borderRadius: 12,
          border: `1px solid ${dragOver ? "var(--accent)" : "var(--border)"}`,
          background: dragOver ? "color-mix(in srgb, var(--accent) 4%, var(--card))" : "var(--card)",
          transition: "border-color 0.15s, background 0.15s",
        }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {/* Preview / Placeholder */}
        <div
          onClick={() => !hasImage && inputRef.current?.click()}
          style={{
            position: "relative",
            width: previewSize,
            height: previewSize,
            borderRadius: radius,
            border: hasImage ? "1px solid var(--border)" : "2px dashed var(--border)",
            background: hasImage ? "transparent" : "var(--bg)",
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            cursor: hasImage ? "default" : "pointer",
          }}
        >
          {hasImage ? (
            <img
              src={value}
              alt={label}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <Upload size={18} color="var(--faint)" strokeWidth={1.5} />
          )}
          {uploading && (
            <div style={{
              position: "absolute",
              inset: 0,
              background: "rgba(0,0,0,0.55)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <Loader2 size={18} color="#fff" style={{ animation: "spin 0.8s linear infinite" }} />
            </div>
          )}
        </div>

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6, flex: 1, minWidth: 0 }}>
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              background: "var(--bg)",
              color: "var(--fg)",
              fontSize: 11,
              fontWeight: 500,
              cursor: "pointer",
              fontFamily: "inherit",
              width: "fit-content",
              transition: "border-color 0.15s",
            }}
          >
            <Upload size={12} />
            {hasImage ? "Trocar" : "Selecionar"}
          </button>

          {hasImage && deletable && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 12px",
                borderRadius: 8,
                border: "1px solid color-mix(in srgb, var(--danger, #ef4444) 30%, var(--border))",
                background: "transparent",
                color: "var(--danger, #ef4444)",
                fontSize: 11,
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
                width: "fit-content",
                opacity: deleting ? 0.5 : 1,
                transition: "opacity 0.15s",
              }}
            >
              <Trash2 size={12} />
              {deleting ? "Removendo..." : "Remover"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <span style={{ fontSize: 11, color: "var(--danger, #ef4444)", paddingLeft: 2 }}>{error}</span>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        style={{ display: "none" }}
      />

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
