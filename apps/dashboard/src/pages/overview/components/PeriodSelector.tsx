import React from "react";

export type PeriodValue = "today" | "7d" | "30d" | "90d";

export type PeriodSelectorProps = {
  value: PeriodValue;
  onChange: (period: PeriodValue) => void;
};

const OPTIONS: Array<{ value: PeriodValue; label: string }> = [
  { value: "today", label: "Hoje" },
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
];

export function PeriodSelector({ value, onChange }: PeriodSelectorProps) {
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        background: "var(--surface-2)",
        border: "1px solid var(--color-border)",
        borderRadius: 999,
        padding: 3,
        gap: 2,
      }}
    >
      {OPTIONS.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.value)}
            style={{
              background: active ? "var(--color-brand)" : "transparent",
              color: active ? "var(--color-bg)" : "var(--color-text-muted)",
              border: "none",
              borderRadius: 999,
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              fontFamily: "var(--font-sans)",
              cursor: "pointer",
              transition: "background 170ms cubic-bezier(0.16,1,0.3,1), color 170ms",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
