import React from "react";

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
  return (
    <div className="cfg-slider">
      <div className="cfg-slider-head">
        <label>{label}</label>
        <output className="cfg-value" style={{ color: error ? "var(--color-error)" : undefined }}>
          {display}
        </output>
      </div>
      <input
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
      {help ? <p className="cfg-help">{help}</p> : null}
      {error ? <p className="cfg-inline-error">{error}</p> : null}
    </div>
  );
}
