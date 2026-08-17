import React, { useCallback, useRef, useState } from "react";
import { Upload, X, Loader2 } from "lucide-react";
import { useApi } from "../hooks/useApi.js";

export interface ImageUploaderProps {
  label: string;
  hint?: string;
  value?: string;
  onChange: (url: string | undefined) => void;
  folder?: string;
  height?: number;
  accept?: string;
  deletable?: boolean;
}

export function ImageUploader({
  label,
  hint,
  value,
  onChange,
  folder,
  height = 120,
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
      setError("Máximo 5MB");
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
      setError("Falha no upload");
    } finally {
      setUploading(false);
    }
  }, [api, onChange]);

  const handleDelete = useCallback(async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!value || !deletable) return;
    setDeleting(true);
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 4 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--fg)" }}>{label}</span>
        {hint && <span style={{ fontSize: 11, color: "var(--faint)" }}>· {hint}</span>}
      </div>

      {/* Upload area — full width, rectangular */}
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        style={{
          position: "relative",
          width: "100%",
          height,
          borderRadius: 10,
          border: hasImage
            ? "1px solid var(--border)"
            : `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
          background: hasImage
            ? "var(--bg)"
            : dragOver ? "color-mix(in srgb, var(--accent) 4%, var(--card))" : "var(--card)",
          overflow: "hidden",
          cursor: "pointer",
          transition: "border-color 0.15s, background 0.15s",
        }}
      >
        {hasImage ? (
          <img
            src={value}
            alt={label}
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 6 }}>
            <Upload size={20} color="var(--faint)" strokeWidth={1.5} />
            <span style={{ fontSize: 11, color: "var(--faint)" }}>
              Arraste ou clique para selecionar
            </span>
          </div>
        )}

        {/* Loading overlay */}
        {uploading && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Loader2 size={22} color="#fff" style={{ animation: "img-spin 0.8s linear infinite" }} />
          </div>
        )}

        {/* Delete X button — top right */}
        {hasImage && deletable && !uploading && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            title="Remover"
            style={{
              position: "absolute",
              top: 8,
              right: 8,
              width: 26,
              height: 26,
              borderRadius: 7,
              border: "none",
              background: "rgba(0, 0, 0, 0.6)",
              backdropFilter: "blur(4px)",
              color: "#fff",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              opacity: deleting ? 0.5 : 1,
              transition: "opacity 0.15s, background 0.15s",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(239, 68, 68, 0.85)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(0, 0, 0, 0.6)"; }}
          >
            {deleting
              ? <Loader2 size={12} style={{ animation: "img-spin 0.8s linear infinite" }} />
              : <X size={14} strokeWidth={2.5} />
            }
          </button>
        )}
      </div>

      {error && <span style={{ fontSize: 11, color: "var(--danger, #ef4444)" }}>{error}</span>}

      <input ref={inputRef} type="file" accept={accept} onChange={handleInputChange} style={{ display: "none" }} />
      <style>{`@keyframes img-spin { to { transform: rotate(360deg); } }`}</style>
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
