"use client";

import { useEffect, useId, useState } from "react";
import { isSelectableServiceTime, serviceDateLabel, serviceTimeEndLabel, type PublicServiceSchedule } from "../../lib/service-schedule";
import styles from "./ServiceScheduleSelector.module.css";
import choiceStyles from "./ProductChoiceControl.module.css";

export function ServiceScheduleSelector({ schedule, selectedSlotId, onChange, disabled = false, error }: {
  schedule: PublicServiceSchedule; selectedSlotId: string | null; onChange: (slotId: string | null) => void; disabled?: boolean; error?: string | null;
}) {
  const headingId = useId(), radioName = useId();
  const dates = [...new Set(schedule.slots.map(slot => slot.date))].sort();
  const selected = schedule.slots.find(slot => slot.slotId === selectedSlotId && isSelectableServiceTime(slot));
  const [date, setDate] = useState(selected?.date ?? schedule.slots.find(slot => isSelectableServiceTime(slot))?.date ?? dates[0] ?? "");
  const signature = schedule.slots.map(slot => `${slot.slotId}:${slot.startsAt}:${slot.selectable}`).join("|");
  useEffect(() => {
    if (!dates.includes(date)) setDate(schedule.slots.find(slot => isSelectableServiceTime(slot))?.date ?? dates[0] ?? "");
  }, [signature, date]);
  const slots = schedule.slots.filter(slot => slot.date === date);
  return <section className={styles.schedule} aria-labelledby={headingId} data-aacp-service-schedule>
    <h2 id={headingId}>Escolha a data e o horário</h2>
    <p className={styles.context}>{schedule.durationMinutes} minutos · Fuso: {schedule.timeZone}</p>
    {!schedule.slots.some(slot => isSelectableServiceTime(slot)) ? <p role="status">Nenhum horário futuro está disponível nesta oferta. Consulte a loja.</p> : <>
      <fieldset disabled={disabled} className={styles.dates}><legend>Data do atendimento</legend>
        <div>{dates.map(value => <button key={value} data-neu="text" type="button" aria-label={`Data ${serviceDateLabel(value)}`} aria-pressed={date === value}
          disabled={disabled || !schedule.slots.some(slot => slot.date === value && isSelectableServiceTime(slot))}
          onClick={() => { setDate(value); onChange(null); }}>{serviceDateLabel(value)}</button>)}</div>
      </fieldset>
      <fieldset disabled={disabled} className={styles.times}><legend>Horários em {serviceDateLabel(date)}</legend>
        <div>{slots.map(slot => <label key={slot.slotId} data-selected={slot.slotId === selectedSlotId} data-unavailable={!isSelectableServiceTime(slot)}>
          <input className={choiceStyles.input} type="radio" name={radioName} value={slot.slotId} checked={slot.slotId === selectedSlotId} disabled={!isSelectableServiceTime(slot)} onChange={() => onChange(slot.slotId)} />
          <span>{slot.startTime} às {serviceTimeEndLabel(slot)}{!isSelectableServiceTime(slot) ? <small>Indisponível</small> : null}</span>
        </label>)}</div>
      </fieldset>
    </>}
    {selected ? <p className={styles.selection} aria-live="polite">Sua escolha: {serviceDateLabel(selected.date)} às {selected.startTime} · {selected.durationMinutes} minutos</p> : null}
    {error ? <p role="alert" className={styles.error}>{error}</p> : null}
    <p className={styles.note}>Ao abrir o checkout, reservamos seu horário por até 10 minutos para o pagamento. A loja confirma o atendimento.</p>
  </section>;
}
