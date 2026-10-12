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
      aria-label="Período dos indicadores"
      className="overview-period-selector"
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
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(opt.value)}
            onKeyDown={event => {
              const index = OPTIONS.findIndex(option => option.value === opt.value);
              const next = event.key === "ArrowRight" ? (index + 1) % OPTIONS.length
                : event.key === "ArrowLeft" ? (index - 1 + OPTIONS.length) % OPTIONS.length
                : event.key === "Home" ? 0 : event.key === "End" ? OPTIONS.length - 1 : -1;
              if (next < 0) return;
              event.preventDefault();
              onChange(OPTIONS[next].value);
              event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
            }}
            style={{
              background: active ? "var(--color-brand)" : "transparent",
              color: active ? "var(--color-bg)" : "var(--color-text-muted)",
              border: "none",
              borderRadius: 999,
              padding: "6px 12px",
              minHeight: 40,
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
