import React, { useCallback, useRef, useState } from "react";
import { Upload, X, Loader2, ImageIcon } from "lucide-react";
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
      onChange(base64); // instant preview
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
      onChange(undefined); // clear locally even if S3 delete fails
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
  const borderRadius = previewRound ? "50%" : "12px";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--fg)" }}>{label}</span>
      {hint && <span style={{ fontSize: "11px", color: "var(--faint)", marginTop: "-2px" }}>{hint}</span>}

      {hasImage ? (
        <div style={{ position: "relative", width: previewSize, height: previewSize }}>
          <img
            src={value}
            alt={label}
            style={{
              width: previewSize,
              height: previewSize,
              objectFit: "cover",
              borderRadius,
              border: "1px solid var(--border)",
            }}
          />
          {deletable && (
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={deleting}
              title="Remover imagem"
              style={{
                position: "absolute",
                top: -6,
                right: -6,
                width: 22,
                height: 22,
                borderRadius: "50%",
                border: "2px solid var(--card)",
                background: "var(--danger, #ef4444)",
                color: "#fff",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                padding: 0,
              }}
            >
              {deleting ? <Loader2 size={10} className="animate-spin" /> : <X size={10} />}
            </button>
          )}
          {uploading && (
            <div style={{
              position: "absolute",
              inset: 0,
              borderRadius,
              background: "rgba(0,0,0,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <Loader2 size={20} color="#fff" className="animate-spin" />
            </div>
          )}
        </div>
      ) : (
        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          style={{
            width: "100%",
            maxWidth: 200,
            height: previewSize,
            borderRadius,
            border: `2px dashed ${dragOver ? "var(--accent)" : "var(--border)"}`,
            background: dragOver ? "color-mix(in srgb, var(--accent) 5%, transparent)" : "var(--card)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            cursor: "pointer",
            transition: "border-color 0.15s, background 0.15s",
          }}
        >
          {uploading ? (
            <Loader2 size={20} color="var(--faint)" className="animate-spin" />
          ) : (
            <>
              <Upload size={18} color="var(--faint)" />
              <span style={{ fontSize: "10px", color: "var(--faint)", textAlign: "center" }}>
                Arraste ou clique
              </span>
            </>
          )}
        </div>
      )}

      {error && (
        <span style={{ fontSize: "11px", color: "var(--danger, #ef4444)" }}>{error}</span>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        style={{ display: "none" }}
      />
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
