"use client";
import { useRef, useState } from "react";
import styles from "./SupportFlow.module.css";

export function SupportPhotoPicker({ images, onChange, disabled = false }: { images: string[]; onChange: (images: string[]) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  async function select(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const chosen = Array.from(files);
    if (chosen.length + images.length > 3) { setError("Você pode enviar até 3 fotos por mensagem."); return; }
    if (chosen.some(file => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 2_000_000)) { setError("Use fotos JPG, PNG ou WEBP de até 2 MB cada."); return; }
    setReading(true);
    try {
      const added = await Promise.all(chosen.map(file => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Não foi possível ler a foto. Tente selecioná-la novamente.")); reader.readAsDataURL(file); })));
      const next = [...images, ...added];
      if (next.reduce((sum, image) => sum + image.length, 0) > 4_500_000) throw new Error("As fotos juntas devem ter até 3,3 MB. Envie as demais em outra mensagem.");
      onChange(next);
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível anexar a foto."); }
    finally { setReading(false); }
  }
  return <div className={styles.stack}>
    <div className={styles.row}><button className={styles.button} type="button" disabled={disabled || reading || images.length >= 3} onClick={() => input.current?.click()} aria-label="Anexar fotos ao atendimento"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m21 11-8 8a6 6 0 0 1-8-8l9-9a4 4 0 0 1 6 6l-9 9a2 2 0 0 1-3-3l8-8" /></svg> {reading ? "Lendo fotos…" : "Anexar fotos"}</button><span className={styles.muted}>Até 3 fotos · 2 MB por foto</span></div>
    <input ref={input} type="file" hidden multiple accept="image/jpeg,image/png,image/webp" onChange={event => { void select(event.target.files); event.target.value = ""; }} />
    {images.length > 0 && <div className={styles.photos}>{images.map((src, index) => <div key={src} className={styles.photo}><img src={src} alt={`Foto anexada ${index + 1}`} /><button className={styles.icon} type="button" disabled={disabled} aria-label={`Remover foto ${index + 1}`} onClick={() => onChange(images.filter((_, i) => i !== index))}>×</button></div>)}</div>}
    {error && <div className={styles.error} role="alert">{error}</div>}
  </div>;
}
