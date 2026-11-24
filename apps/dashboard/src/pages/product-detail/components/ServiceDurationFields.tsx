import React, { useEffect, useId } from "react";
import type { ProductMetadata } from "../ProductDetailPage.js";
import { withServiceDurationDraft } from "../utils/service-duration-metadata.js";

export function ServiceDurationFields({ metadata, onChange, error }: { metadata: ProductMetadata; onChange: (next: ProductMetadata) => void; error?: string }) {
  const id = useId(), errorId = id + "-error", raw = metadata.serviceSchedule;
  // Warm the destination of this visible service-only CTA. Importing its code
  // mounts no management view and performs no administrative reads or writes.
  useEffect(() => { void import("../../service-attendance/ServiceAttendancePage.js").catch(() => undefined); }, []);
  const malformed = raw !== undefined && (!raw || typeof raw !== "object" || !Array.isArray(raw.slots));
  const link = <a className="zyn-btn zyn-btn--outline zyn-btn--md" href="#service-attendance?tab=availability">Gerenciar horários no Atendimento</a>;
  if (malformed) return <section><h3>Horários do serviço</h3><p role="alert">Os registros anteriores de horários precisam de revisão. Eles foram preservados; esta edição não os converte nem apaga.</p>{link}</section>;
  return <section style={{ display: "grid", gap: 12, minWidth: 0, padding: 16, border: "1px solid var(--color-border)", borderRadius: 12 }}>
    <h3 style={{ margin: 0 }}>Horários do serviço</h3>
    <label htmlFor={id} style={{ display: "grid", gap: 6 }}>Duração em minutos
      <input id={id} type="number" className="form-input" min={5} max={480} step={1} value={Number.isFinite(raw?.durationMinutes) ? raw!.durationMinutes : ""}
        aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} onChange={event => onChange(withServiceDurationDraft({ ...metadata }, event.target.value) as ProductMetadata)} />
    </label>
    <p style={{ margin: 0 }}>Os horários, o fuso e as indisponibilidades são gerenciados por profissional no Atendimento. Alterar a duração mantém os registros anteriores.</p>
    {!raw && <p style={{ margin: 0 }}>Informe uma duração para usar a disponibilidade por profissional.</p>}
    {link}
    {error && <p id={errorId} role="alert">{error}</p>}
  </section>;
}
