import React from "react";

export function NumberField({
  label,
  help,
  value,
  min,
  max,
  disabled,
  onChange,
  error,
  suffix,
}: {
  label: string;
  help?: string;
  value: number;
  min?: number;
  max?: number;
  disabled: boolean;
  onChange: (v: number) => void;
  error?: string;
  suffix?: string;
}) {
  return (
    <div className="cfg-field">
      <label>{label}</label>
      <div className={`cfg-number${error ? " has-error" : ""}`}>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {suffix ? <span className="cfg-number-suffix">{suffix}</span> : null}
      </div>
      {help ? <p className="cfg-help">{help}</p> : null}
      {error ? <p className="cfg-inline-error">{error}</p> : null}
    </div>
  );
}
