import React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
  disabled?: boolean;
}

export function Pagination({ page, pageSize, total, onChange, disabled }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const canPrev = page > 1;
  const canNext = page < totalPages;

  const start = Math.min((page - 1) * pageSize + 1, total);
  const end = Math.min(page * pageSize, total);

  return (
    <div role="navigation" aria-label="Paginação" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 22px", borderTop: "1px solid var(--border)", background: "var(--card)" }}>
      <span style={{ font: "12.5px var(--mono)", color: "var(--muted)" }}>
        {total === 0 ? "Nenhum item" : `${start}–${end} de ${total}`}
      </span>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <button
          type="button"
          disabled={!canPrev || disabled}
          onClick={() => onChange(page - 1)}
          aria-label="Página anterior"
          style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid var(--ink)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: canPrev && !disabled ? "pointer" : "not-allowed", opacity: canPrev && !disabled ? 1 : 0.4, color: "var(--ink)" }}
        >
          <ChevronLeft size={14} color="oklch(96% 0.002 145)" />
        </button>
        <span style={{ font: "600 12px var(--mono)", color: "var(--ink)", padding: "0 8px", minWidth: 40, textAlign: "center" }}>{page} / {totalPages}</span>
        <button
          type="button"
          disabled={!canNext || disabled}
          onClick={() => onChange(page + 1)}
          aria-label="Próxima página"
          style={{ width: 28, height: 28, borderRadius: 6, border: "1px solid var(--ink)", background: "transparent", display: "flex", alignItems: "center", justifyContent: "center", cursor: canNext && !disabled ? "pointer" : "not-allowed", opacity: canNext && !disabled ? 1 : 0.4, color: "var(--ink)" }}
        >
          <ChevronRight size={14} color="oklch(96% 0.002 145)" />
        </button>
      </div>
    </div>
  );
}
