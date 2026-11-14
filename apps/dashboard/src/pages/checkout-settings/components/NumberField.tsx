import React, { useId } from "react";

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
  const id = useId();
  return (
    <div className="cfg-field">
      <label htmlFor={id}>{label}</label>
      <div className={`cfg-number${error ? " has-error" : ""}`}>
        <input id={id} aria-invalid={Boolean(error)} aria-describedby={[help && `${id}-help`, error && `${id}-error`].filter(Boolean).join(" ") || undefined}
          type="number"
          min={min}
          max={max}
          value={Number.isFinite(value) ? value : ""}
          disabled={disabled}
          onChange={(e) => {
            const raw = e.target.value;
            // Empty input → fall back to the min (or 0) instead of propagating NaN,
            // which would render the field blank and break the derived help text.
            const parsed = raw === "" ? (min ?? 0) : Number(raw);
            onChange(Number.isFinite(parsed) ? parsed : (min ?? 0));
          }}
        />
        {suffix ? <span className="cfg-number-suffix">{suffix}</span> : null}
      </div>
      {help ? <p id={`${id}-help`} className="cfg-help">{help}</p> : null}
      {error ? <p id={`${id}-error`} className="cfg-inline-error" role="alert">{error}</p> : null}
    </div>
  );
}
