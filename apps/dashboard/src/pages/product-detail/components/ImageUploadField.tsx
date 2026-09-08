import React, { useCallback, useRef, useState } from "react";
import { ImagePlus, X, Loader2 } from "lucide-react";
import { useApi } from "../../../hooks/useApi.js";
import { showToast } from "../../../components/Toast.js";

/**
 * Drop zone + click-to-upload field for Advanced Product Layout image blocks.
 *
 * Persists the image to S3 through `POST /merchants/:mid/products/:pid/content/upload`
 * (returns the CDN URL the editor should store on the block's `props`).
 *
 * The field is a controlled input: `value` is the current URL, `onChange` is
 * called with the new URL after upload or `""` after removal. The `disabled`
 * flag matches the editor's `readOnly` mode.
 */
export interface ImageUploadFieldProps {
  merchantId: string;
  productId: string;
  value: string;
  onChange: (url: string) => void;
  label?: string;
  /** "image" shows image previews + accepts image/*. "video" accepts video/mp4 only. */
  kind?: "image" | "video";
  /** Hide the preview above the picker (e.g. dense carousels). */
  hidePreview?: boolean;
  disabled?: boolean;
}

const labelStyle: React.CSSProperties = {
  font: "600 11px var(--font-sans)",
  color: "var(--color-text-muted)",
  display: "block",
  marginBottom: 4,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const IMAGE_UPLOAD_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

async function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read_error"));
    reader.readAsDataURL(file);
  });
}

export function ImageUploadField({
  merchantId,
  productId,
  value,
  onChange,
  label = "Imagem",
  kind = "image",
  hidePreview = false,
  disabled = false,
}: ImageUploadFieldProps) {
  const api = useApi();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);

  const isVideo = kind === "video";
  const accept = isVideo ? "video/mp4" : "image/png,image/jpeg,image/webp,image/gif";
  const ctaLabel = isVideo
    ? value ? "Trocar vídeo" : "Enviar vídeo"
    : value ? "Trocar imagem" : "Enviar imagem";
  const successLabel = isVideo ? "Vídeo enviado" : "Imagem enviada";

  const handleFile = useCallback(
    async (file: File | null) => {
      if (!file || disabled) return;
      const isAllowedType = isVideo ? file.type === "video/mp4" : IMAGE_UPLOAD_TYPES.has(file.type);
      if (!isAllowedType) {
        showToast("error", isVideo ? "Selecione um arquivo de vídeo" : "Selecione um arquivo de imagem");
        return;
      }
      // Video files are large — confirm before upload.
      if (file.size > 10 * 1024 * 1024) {
        showToast("error", "O arquivo deve ter no máximo 10 MB");
        return;
      }
      try {
        setUploading(true);
        const dataUri = await fileToDataUri(file);
        const result = await api.uploadContentImage(merchantId, productId, dataUri);
        onChange(result.url);
        showToast("success", successLabel);
      } catch (e) {
        showToast("error", e instanceof Error ? e.message : "Erro ao enviar arquivo");
      } finally {
        setUploading(false);
        if (inputRef.current) inputRef.current.value = "";
      }
    },
    [api, merchantId, productId, onChange, disabled, isVideo, successLabel],
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {label ? <span style={labelStyle}>{label}</span> : null}
      <div style={{ display: "flex", alignItems: "stretch", gap: 10 }}>
        {!hidePreview && value && !isVideo ? (
          <div
            style={{
              width: 96,
              height: 96,
              flexShrink: 0,
              border: "1px solid var(--color-border)",
              borderRadius: 8,
              background: "var(--surface-1)",
              overflow: "hidden",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <img
              src={value}
              alt=""
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          </div>
        ) : null}

        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => inputRef.current?.click()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              padding: "10px 12px",
              borderRadius: 8,
              border: "2px dashed var(--color-border)",
              background: "var(--surface-1)",
              color: "var(--color-text)",
              font: "500 12px var(--font-sans)",
              cursor: disabled || uploading ? "not-allowed" : "pointer",
              opacity: disabled ? 0.5 : 1,
            }}
          >
            {uploading ? (
              <>
                <Loader2 size={13} style={{ animation: "spin 1s linear infinite" }} /> Enviando...
              </>
            ) : (
              <>
                <ImagePlus size={13} /> {ctaLabel}
              </>
            )}
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={accept}
            style={{ display: "none" }}
            disabled={disabled || uploading}
            onChange={(e) => void handleFile(e.target.files?.[0] ?? null)}
          />
          {value ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  font: "500 11px var(--font-mono)",
                  color: "var(--color-text-faint)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                }}
                title={value}
              >
                {value.split("/").pop()}
              </span>
              <button
                type="button"
                disabled={disabled || uploading}
                onClick={() => onChange("")}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  background: "transparent",
                  border: "1px solid var(--color-border)",
                  borderRadius: 6,
                  padding: "4px 8px",
                  font: "500 11px var(--font-sans)",
                  color: "var(--color-danger, #b91c1c)",
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
              >
                <X size={11} /> Remover
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
