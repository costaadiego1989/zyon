import React from "react";
import "./period-filter.css";

type Props = {
  presets: ReadonlyArray<{ key: string; label: string }>;
  active: string;
  onPreset: (key: string) => void;
  from: string;
  to: string;
  onDate: (field: "from" | "to", value: string) => void;
  action?: React.ReactNode;
};

/** Shared period controls, following the Orders and Shipments toolbar. */
export function PeriodFilter({ presets, active, onPreset, from, to, onDate, action }: Props) {
  return <div className="period-filter" role="group" aria-label="Filtrar por período">
    <div className="period-filter__presets">
      {presets.map(({ key, label }) => <button key={key} type="button" aria-pressed={key === active} onClick={() => onPreset(key)}>{label}</button>)}
    </div>
    <div className="period-filter__range">
      <input type="date" aria-label="Data inicial" value={from} max={to || undefined} onChange={event => onDate("from", event.target.value)} />
      <span>até</span>
      <input type="date" aria-label="Data final" value={to} min={from || undefined} onChange={event => onDate("to", event.target.value)} />
      {action}
    </div>
  </div>;
}
