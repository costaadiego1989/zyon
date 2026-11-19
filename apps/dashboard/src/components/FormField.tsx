import React, { useId } from "react";

export interface FormFieldProps {
  label: string;
  type?: "text" | "email" | "tel" | "password" | "number" | "url" | "date";
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  hint?: string;
  error?: string;
  autoFocus?: boolean;
  maxLength?: number;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  inputProps?: Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "id" | "type">;
}

export function FormField({ label, type = "text", placeholder, value, onChange, disabled, hint, error, autoFocus, maxLength, onKeyDown, inputProps }: FormFieldProps) {
  const id = useId();
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <input
        {...inputProps}
        id={id}
        aria-describedby={hint || error ? id + "-help" : undefined}
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
      {hint && !error ? <span id={id + "-help"} className="form-field-hint">{hint}</span> : null}
      {error ? <span id={id + "-help"} className="form-field-error" role="alert">{error}</span> : null}
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
  error?: string;
  inputProps?: Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange" | "id">;
}

export function FormSelect({ label, value, onChange, options, disabled, hint, error, inputProps }: FormSelectProps) {
  const id = useId();
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <select {...inputProps} id={id} aria-invalid={!!error} aria-describedby={hint || error ? id + "-help" : undefined} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      {hint && !error ? <span id={id + "-help"} className="form-field-hint">{hint}</span> : null}
      {error ? <span id={id + "-help"} className="form-field-error" role="alert">{error}</span> : null}
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
  error?: string;
  inputProps?: Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "id">;
}

export function FormTextarea({ label, placeholder, value, onChange, disabled, rows = 3, hint, maxLength, error, inputProps }: FormTextareaProps) {
  const id = useId();
  return (
    <div className="form-field">
      <label htmlFor={id}>{label}</label>
      <textarea
        {...inputProps}
        id={id}
        aria-invalid={!!error}
        aria-describedby={hint || error ? id + "-help" : undefined}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={rows}
        maxLength={maxLength}
      />
      {hint && !error ? <span id={id + "-help"} className="form-field-hint">{hint}</span> : null}
      {error ? <span id={id + "-help"} className="form-field-error" role="alert">{error}</span> : null}
    </div>
  );
}
