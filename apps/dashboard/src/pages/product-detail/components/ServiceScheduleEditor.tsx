import { useId } from "react";
import type { ServiceScheduleDraft } from "../utils/service-schedule-validation.js";

const inputStyle = { width: "100%", minWidth: 0, padding: "9px 10px", borderRadius: 8, border: "1px solid var(--color-border)", background: "var(--surface-1)", color: "var(--color-text)", font: "13px var(--font-sans)" };
const labelStyle = { display: "grid", gap: 6, minWidth: 0, font: "12px var(--font-sans)" };
const zones = ["America/Sao_Paulo", "America/Manaus", "America/Fortaleza", "America/Rio_Branco"];
export function ServiceScheduleEditor({ value, onChange, error }: { value?: ServiceScheduleDraft; onChange: (value: ServiceScheduleDraft | undefined) => void; error?: string }) {
  const errorId = useId();
  if (value !== undefined && (!value || typeof value !== "object" || !Array.isArray(value.slots)
    || value.slots.some(slot => !slot || typeof slot.id !== "string" || typeof slot.date !== "string" || typeof slot.startTime !== "string"))) {
    return <section style={{ padding: 16, border: "1px solid var(--color-border)", borderRadius: 12 }}><h3>Horários do serviço</h3>
      <p role="alert">A configuração salva contém horários inválidos. Reconfigure os horários antes de publicar esta oferta.</p>
      <button type="button" onClick={() => onChange({ timeZone: "America/Sao_Paulo", durationMinutes: 30, slots: [] })}>Reconfigurar horários</button>
    </section>;
  }
  const slots = Array.isArray(value?.slots) ? value.slots : [];
  return <section style={{ display: "grid", gap: 14, padding: "20px 22px", border: "1px solid var(--color-border)", borderRadius: 14, background: "var(--surface-2)", minWidth: 0 }}>
    <h3 style={{ margin: 0, font: "600 14px var(--font-sans)" }}>Horários do serviço</h3>
    <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13 }}><input type="checkbox" checked={value !== undefined}
      onChange={event => onChange(event.target.checked ? { timeZone: "America/Sao_Paulo", durationMinutes: 30, slots: [] } : undefined)} />Exigir escolha de data e horário</label>
    {value !== undefined ? <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <label style={labelStyle}>Fuso do atendimento<select style={inputStyle} value={value.timeZone ?? ""} onChange={event => onChange({ ...value, timeZone: event.target.value })}>
          {[...new Set([...zones, ...(value.timeZone ? [value.timeZone] : [])])].map(zone => <option key={zone} value={zone}>{zone === "America/Sao_Paulo" ? "Brasília · America/Sao_Paulo" : zone}</option>)}
        </select></label>
        <label style={labelStyle}>Duração em minutos<input style={inputStyle} type="number" min={5} max={480} step={5} value={Number.isFinite(value.durationMinutes) ? value.durationMinutes : ""}
          onChange={event => onChange({ ...value, durationMinutes: event.target.value === "" ? Number.NaN : Number(event.target.value) })} /></label>
      </div>
      <p style={{ color: "var(--color-text-muted)", fontSize: 12, margin: 0 }}>Adicione as datas e os horários oferecidos. O comprador escolhe um deles; essa escolha acompanha o pedido.</p>
      {slots.map((slot, index) => <fieldset key={slot.id} style={{ minWidth: 0, margin: 0, padding: 12, border: "1px solid var(--color-border)", borderRadius: 10 }}>
        <legend style={{ fontSize: 12, padding: "0 6px" }}>Horário {index + 1}</legend>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, alignItems: "end" }}>
          <label style={labelStyle}>Data do atendimento<input style={inputStyle} type="date" value={slot.date} aria-label={`Data do horário ${index + 1}`} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
            onChange={event => onChange({ ...value, slots: slots.map(item => item.id === slot.id ? { ...item, date: event.target.value } : item) })} /></label>
          <label style={labelStyle}>Hora de início<input style={inputStyle} type="time" value={slot.startTime} aria-label={`Início do horário ${index + 1}`} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined}
            onChange={event => onChange({ ...value, slots: slots.map(item => item.id === slot.id ? { ...item, startTime: event.target.value } : item) })} /></label>
          <button type="button" onClick={() => onChange({ ...value, slots: slots.filter(item => item.id !== slot.id) })} aria-label={`Remover horário ${index + 1}`}
            style={{ minHeight: 40, border: "1px solid var(--color-border)", background: "var(--surface-1)", color: "var(--color-text)", borderRadius: 8 }}>Remover horário</button>
        </div>
      </fieldset>)}
      <button type="button" disabled={slots.length >= 200} onClick={() => onChange({ ...value, slots: [...slots, { id: crypto.randomUUID(), date: "", startTime: "" }] })}
        style={{ justifySelf: "start", padding: "10px 14px", borderRadius: 8, border: "1px solid var(--color-brand-ring)", background: "var(--color-brand-subtle)", color: "var(--color-brand-hover)" }}>Adicionar horário</button>
      {!slots.length ? <p style={{ fontSize: 12, margin: 0 }}>Sem horários configurados, esta oferta não fica disponível para compra com agendamento.</p> : null}
      <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>Confira horários e fuso antes de salvar. O comprador envia a escolha com o pedido; você confirma o atendimento.</p>
    </> : null}
    {error ? <p id={errorId} role="alert" style={{ color: "var(--color-error)", margin: 0, fontSize: 12 }}>{error}</p> : null}
  </section>;
}
