import React from "react";

export interface FormFieldProps {
  label: string;
  type?: "text" | "email" | "tel" | "password" | "number" | "url";
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  hint?: string;
  error?: string;
  autoFocus?: boolean;
  maxLength?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function FormField({ label, type = "text", placeholder, value, onChange, disabled, hint, error, autoFocus, maxLength, onKeyDown }: FormFieldProps) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={maxLength}
        aria-invalid={!!error}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
      />
      {hint && !error ? <span className="form-field-hint">{hint}</span> : null}
      {error ? <span className="form-field-error">{error}</span> : null}
    </div>
  );
}

export interface FormSelectProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  hint?: string;
}

export function FormSelect({ label, value, onChange, options, disabled, hint }: FormSelectProps) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {hint ? <span className="form-field-hint">{hint}</span> : null}
    </div>
  );
}

export interface FormTextareaProps {
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  rows?: number;
  hint?: string;
  maxLength?: number;
}

export function FormTextarea({ label, placeholder, value, onChange, disabled, rows = 3, hint, maxLength }: FormTextareaProps) {
  return (
    <div className="form-field">
      <label>{label}</label>
      <textarea
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={rows}
        maxLength={maxLength}
      />
      {hint ? <span className="form-field-hint">{hint}</span> : null}
    </div>
  );
}
