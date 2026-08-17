import React from "react";
import { X } from "lucide-react";

export interface ImageUploadFieldProps {
  label: string;
  hint?: string;
  value?: string;
  onChange: (url: string | undefined) => void;
  onUpload: (base64: string) => Promise<string | undefined>;
  previewSize?: number;
  previewRound?: boolean;
  accept?: string;
}

/**
 * Reusable image upload field with preview + X delete button.
 * Consistent look across theme page, stories, onboarding.
 */
export function ImageUploadField({
  label,
  hint,
  value,
  onChange,
  onUpload,
  previewSize = 80,
  previewRound = false,
  accept = "image/*",
}: ImageUploadFieldProps) {
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const base64 = reader.result as string;
      onChange(base64);
      const uploaded = await onUpload(base64);
      if (uploaded) onChange(uploaded);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  return (
    <div>
      <div style={{ fontWeight: 600, fontSize: 13, color: "var(--ink)", marginBottom: 4 }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: "var(--faint)", marginBottom: 10 }}>{hint}</div>}

      {value ? (
        <div style={{ position: "relative", display: "inline-block" }}>
          <img
            src={value}
            alt={label}
            style={{
              width: previewSize,
              height: previewRound ? previewSize : "auto",
              maxHeight: previewSize * 1.5,
              objectFit: "cover",
              borderRadius: previewRound ? "50%" : 10,
              border: "1px solid var(--rule, #333)",
              display: "block",
            }}
          />
          <button
            type="button"
            onClick={() => onChange(undefined)}
            aria-label="Remover imagem"
            style={{
              position: "absolute",
              top: -6,
              right: -6,
              width: 24,
              height: 24,
              borderRadius: 8,
              border: "1px solid var(--rule, #333)",
              background: "var(--card, #222)",
              color: "var(--ink, #fff)",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              boxShadow: "0 2px 6px rgba(0,0,0,0.3)",
            }}
          >
            <X size={12} strokeWidth={2.5} />
          </button>
        </div>
      ) : (
        <label style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "16px 20px",
          borderRadius: 8,
          border: "2px dashed var(--rule)",
          background: "var(--bg)",
          cursor: "pointer",
          fontSize: 12,
          color: "var(--muted)",
          transition: "border-color 0.15s",
        }}>
          Arraste ou clique para enviar
          <input type="file" accept={accept} onChange={handleFile} style={{ display: "none" }} />
        </label>
      )}
    </div>
  );
}
