"use client";
import { useId, useRef, useState } from "react";
import styles from "./SupportPhotoPicker.module.css";

export function SupportPhotoPicker({ images, onChange, disabled = false, compact = false, onReadingChange }: {
  images: string[]; onChange: (images: string[]) => void; disabled?: boolean;
  compact?: boolean; onReadingChange?: (reading: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const names = useRef(new Map<string, string>());
  const hintId = useId();
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const locked = disabled || reading;
  async function select(files: FileList | File[] | null) {
    if (locked || !files?.length) return;
    setError(null); setDragging(false);
    const chosen = Array.from(files);
    if (chosen.length + images.length > 3) { setError("Você pode enviar até 3 fotos por mensagem."); return; }
    if (chosen.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || !file.size || file.size > 2_000_000)) { setError("Use fotos JPG, PNG ou WebP de até 2 MB cada."); return; }
    setReading(true); onReadingChange?.(true);
    try {
      const added = await Promise.all(chosen.map(file => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Não foi possível ler a foto. Tente selecioná-la novamente.")); reader.readAsDataURL(file); })));
      const next = [...images, ...added];
      if (next.reduce((sum, image) => sum + image.length, 0) > 4_500_000) throw new Error("As fotos juntas devem ter até 3,3 MB. Envie as demais em outra mensagem.");
      added.forEach((src, index) => names.current.set(src, chosen[index].name));
      onChange(next);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível anexar a foto."); }
    finally { setReading(false); onReadingChange?.(false); }
  }
  return <div className={styles.picker} data-compact={compact || undefined} aria-busy={reading}>
    <div className={styles.dropzone} data-dragging={dragging || undefined}
      onDragOver={event => { event.preventDefault(); if (!locked && images.length < 3) setDragging(true); }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={event => { event.preventDefault(); setDragging(false); void select(event.dataTransfer.files); }}>
      <button className={styles.select} type="button" disabled={locked || images.length >= 3}
        onClick={() => input.current?.click()} aria-label="Anexar fotos ao atendimento" aria-describedby={hintId}>
        <span className={styles.uploadIcon}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5-8 11M3 16l4-4 4 4" /></svg></span>
        <span className={styles.selectText}><strong>{reading ? "Preparando fotos…" : images.length >= 3 ? "3 fotos selecionadas" : images.length ? "Adicionar outra foto" : "Adicionar fotos"}</strong><span id={hintId}>{compact ? "JPG, PNG ou WebP · até 2 MB cada" : "Selecione os arquivos ou arraste as fotos aqui"}</span></span>
        <span className={styles.count}>{images.length}/3</span>
      </button>
      {!compact && <p className={styles.hint}>JPG, PNG ou WebP · até 2 MB por foto</p>}
    </div>
    <input ref={input} type="file" hidden multiple accept="image/jpeg,image/png,image/webp" disabled={locked} onChange={event => { void select(event.target.files); event.target.value = ""; }} />
    {images.length > 0 && <ul className={styles.previews} aria-label="Fotos selecionadas">{images.map((src, index) => <li key={`${index}-${src.slice(-32)}`} className={styles.preview}>
      <img src={src} alt={`Prévia da foto ${index + 1}`} />
      <div className={styles.file}><strong title={names.current.get(src)}>{names.current.get(src) || `Foto ${index + 1}`}</strong><span>Pronta para enviar</span></div>
      <button className={styles.remove} type="button" disabled={locked} aria-label={`Remover foto ${index + 1}`} onClick={() => { setError(null); onChange(images.filter((_, i) => i !== index)); }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
    </li>)}</ul>}
    <span className={styles.status} role="status">{reading ? "Lendo as fotos selecionadas." : images.length ? `${images.length} ${images.length === 1 ? "foto preparada" : "fotos preparadas"}. O envio acontece ao confirmar.` : ""}</span>
    {error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}
