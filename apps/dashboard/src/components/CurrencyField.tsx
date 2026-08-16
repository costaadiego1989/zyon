import React from "react";
import { applyCurrencyMask } from "../utils/currency.js";

export interface CurrencyFieldProps {
  label: string;
  value: string;
  onChange: (formatted: string) => void;
  error?: string;
  placeholder?: string;
}

/**
 * Input monetário com máscara live pt-BR.
 * Aceita só dígitos, formata como reais enquanto digita:
 * "2590" → "25,90" | "150000" → "1.500,00"
 */
export function CurrencyField({ label, value, onChange, error, placeholder = "0,00" }: CurrencyFieldProps) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ font: "600 11px var(--sans)", color: "var(--ink)", display: "block", marginBottom: 4 }}>{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(applyCurrencyMask(e.target.value))}
        placeholder={placeholder}
        inputMode="numeric"
        style={{ width: "100%", padding: "7px 10px", borderRadius: 7, border: `1px solid ${error ? "var(--danger)" : "var(--border)"}`, font: "12.5px var(--mono)", color: "var(--ink)", outline: "none", background: "var(--card)" }}
      />
      {error ? (
        <span style={{ font: "11px var(--sans)", color: "var(--danger)", marginTop: 4, display: "block" }}>{error}</span>
      ) : null}
    </label>
  );
}
