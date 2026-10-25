import React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
export interface PaginationProps { page: number; pageSize: number; total: number; onChange: (page: number) => void; disabled?: boolean; }
export function Pagination({ page, pageSize, total, onChange, disabled }: PaginationProps) {
  const count = Math.max(0, total);
  const size = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(count / size));
  const current = Math.max(1, Math.min(page, totalPages));
  const start = count ? (current - 1) * size + 1 : 0;
  const end = Math.min(current * size, count);
  return <nav aria-label="Paginação" className="ui-pagination">
    <span className="ui-pagination__range" aria-live="polite">{count ? start.toLocaleString("pt-BR") + "–" + end.toLocaleString("pt-BR") + " de " + count.toLocaleString("pt-BR") : "Nenhum item"}</span>
    <div className="ui-pagination__controls">
      {totalPages > 5 && <button type="button" className="ui-icon-button" disabled={current === 1 || disabled} onClick={() => onChange(1)} aria-label="Primeira página"><ChevronsLeft size={16} aria-hidden="true" /></button>}
      <button type="button" className="ui-icon-button" disabled={current === 1 || disabled} onClick={() => onChange(current - 1)} aria-label="Página anterior"><ChevronLeft size={16} aria-hidden="true" /></button>
      <span className="ui-pagination__current">Página <strong>{current}</strong> de {totalPages}</span>
      <button type="button" className="ui-icon-button" disabled={current === totalPages || disabled} onClick={() => onChange(current + 1)} aria-label="Próxima página"><ChevronRight size={16} aria-hidden="true" /></button>
      {totalPages > 5 && <button type="button" className="ui-icon-button" disabled={current === totalPages || disabled} onClick={() => onChange(totalPages)} aria-label="Última página"><ChevronsRight size={16} aria-hidden="true" /></button>}
    </div>
  </nav>;
}
