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
    <div className="pagination" role="navigation" aria-label="Paginação">
      <span className="pagination-info">
        {total === 0 ? "Nenhum item" : `${start}–${end} de ${total}`}
      </span>
      <div className="pagination-controls">
        <button
          type="button"
          className="pagination-btn"
          disabled={!canPrev || disabled}
          onClick={() => onChange(page - 1)}
          aria-label="Página anterior"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="pagination-page">{page} / {totalPages}</span>
        <button
          type="button"
          className="pagination-btn"
          disabled={!canNext || disabled}
          onClick={() => onChange(page + 1)}
          aria-label="Próxima página"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
