"use client";

import { useRef, useState } from "react";
import type { ConversationAttachment } from "@/lib/viewmodels/useConversationViewModel/types";
import styles from "./AttachmentPicker.module.css";

const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_LIST_BYTES = 24 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const LIST_TYPES = new Set(["text/plain", "text/csv"]);

function filename(file: File) {
  return file.name.trim().replace(/[\u0000-\u001f]/g, "").slice(0, 120) || "anexo";
}

async function readAttachment(file: File): Promise<ConversationAttachment> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  const mimeType = file.type || ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", txt: "text/plain", csv: "text/csv" } as Record<string, string>)[extension || ""];
  const image = IMAGE_TYPES.has(mimeType);
  if (!image && !LIST_TYPES.has(mimeType)) throw new Error("Envie JPG, PNG, WEBP, TXT ou CSV.");
  if (!file.size || file.size > (image ? MAX_IMAGE_BYTES : MAX_LIST_BYTES)) {
    throw new Error(image ? "A imagem deve ter até 3 MB." : "A lista deve ter até 24 KB.");
  }
  if (!image) {
    const text = (await file.text()).replace(/\u0000/g, "").trim();
    if (!text) throw new Error("A lista está vazia. Escolha um arquivo com os produtos.");
    return { kind: "shopping_list", name: filename(file), mimeType: mimeType as "text/plain" | "text/csv", text };
  }
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler este anexo. Tente novamente."));
    reader.onload = () => {
      const base64 = typeof reader.result === "string" ? reader.result.split(",", 2)[1] : undefined;
      if (base64) resolve(base64); else reject(new Error("Não foi possível ler este anexo. Tente novamente."));
    };
    reader.readAsDataURL(file);
  });
  return { kind: "image", name: filename(file), mimeType: mimeType as "image/jpeg" | "image/png" | "image/webp", dataBase64 };
}

export function AttachmentPicker({ attachment, disabled, onChange, onReadingChange }: {
  attachment: ConversationAttachment | null;
  disabled?: boolean;
  onChange: (attachment: ConversationAttachment | null) => void;
  onReadingChange: (reading: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const chooseFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    onChange(null);
    setReading(true);
    onReadingChange(true);
    try { onChange(await readAttachment(file)); }
    catch (error) { setError(error instanceof Error ? error.message : "Não foi possível ler este anexo. Tente novamente."); }
    finally {
      setReading(false);
      onReadingChange(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return <>
    <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp,text/plain,text/csv,.jpg,.jpeg,.png,.webp,.txt,.csv" onChange={(event) => void chooseFile(event.currentTarget.files?.[0])} hidden />
    <button data-neu="icon" className={styles.attach} type="button" disabled={disabled || reading} onClick={() => inputRef.current?.click()} aria-label="Anexar imagem ou lista de compras" title="Anexar imagem ou lista (JPG, PNG, WEBP, TXT ou CSV)">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21.4 11.6 12 21a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 1 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5" /></svg>
    </button>
    {attachment ? <div role="status" className={styles.preview}>
      <span title={attachment.name}>{attachment.kind === "image" ? "Imagem: " : "Lista: "}{attachment.name}</span>
      <button data-neu="icon" type="button" disabled={disabled} onClick={() => { onChange(null); setError(null); }} aria-label="Remover anexo">×</button>
    </div> : null}
    {reading ? <div role="status" className={styles.feedback}>Lendo anexo…</div> : null}
    {error ? <div role="alert" className={styles.feedback}>{error}</div> : null}
  </>;
}
