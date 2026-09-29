import React, { useId } from "react";

export function SliderField({
  label,
  help,
  value,
  min,
  max,
  step,
  disabled,
  display,
  onChange,
  error,
}: {
  label: string;
  help?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  display: string;
  onChange: (v: number) => void;
  error?: string;
}) {
  const pct = Math.max(0, Math.min(100, ((value - min) / (max - min)) * 100));
  const id = useId();
  return (
    <div className="cfg-slider">
      <div className="cfg-slider-head">
        <label htmlFor={id}>{label}</label>
        <output className="cfg-value" style={{ color: error ? "var(--color-error)" : undefined }}>
          {display}
        </output>
      </div>
      <input id={id} aria-invalid={Boolean(error)} aria-describedby={[help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ") || undefined}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="cfg-range"
        style={{ "--fill": `${pct}%` } as React.CSSProperties}
      />
      {help ? <p id={`${id}-help`} className="cfg-help">{help}</p> : null}
      {error ? <p id={`${id}-error`} className="cfg-inline-error" role="alert">{error}</p> : null}
    </div>
  );
}
