import React from "react";

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
  disabled?: boolean;
}

function ChevronLeftIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

function ChevronRightIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export function Pagination({ page, pageSize, total, onChange, disabled }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  const start = Math.min((page - 1) * pageSize + 1, total);
  const end = Math.min(page * pageSize, total);

  const btnStyle = (enabled: boolean): React.CSSProperties => ({
    width: 30,
    height: 30,
    borderRadius: 7,
    border: "1px solid var(--color-border)",
    background: "var(--surface-1)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.35,
    color: "#fff",
    padding: 0,
    font: "inherit",
  });

  return (
    <div role="navigation" aria-label="Paginação" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderTop: "1px solid var(--color-border)" }}>
      <span style={{ font: "12px var(--font-mono)", color: "var(--color-text-muted)" }}>
        {total === 0 ? "Nenhum item" : `${start}–${end} de ${total}`}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          disabled={!canPrev || disabled}
          onClick={() => onChange(page - 1)}
          aria-label="Página anterior"
          style={btnStyle(canPrev && !disabled)}
        >
          <ChevronLeftIcon />
        </button>
        <span style={{ font: "600 12px var(--font-mono)", color: "var(--color-text)", minWidth: 44, textAlign: "center" }}>
          {page} / {totalPages}
        </span>
        <button
          type="button"
          disabled={!canNext || disabled}
          onClick={() => onChange(page + 1)}
          aria-label="Próxima página"
          style={btnStyle(canNext && !disabled)}
        >
          <ChevronRightIcon />
        </button>
      </div>
    </div>
  );
}
