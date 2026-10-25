import React, { type ReactNode } from "react";
import { SectionHeader } from "./SectionHeader.js";
import { Pagination } from "./Pagination.js";
import { EmptyState } from "./EmptyState.js";
import type { LucideIcon } from "lucide-react";

/**
 * DataPanel — Standard list/table container with title, pagination, and empty state.
 *
 * Ensures consistent spacing across all list views:
 * - Title: 20px top/horizontal padding, SectionHeader secondary
 * - Content: full-width, no horizontal padding (tables handle their own)
 * - Pagination: borderTop, 16px 20px padding
 * - EmptyState: centered when no items
 */
export interface DataPanelProps {
  title: string;
  trailing?: ReactNode;
  children: ReactNode;
  page?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  empty?: { icon: LucideIcon; title: string; description: string; action?: ReactNode };
  isEmpty?: boolean;
}

export function DataPanel({
  title,
  trailing,
  children,
  page,
  pageSize,
  total,
  onPageChange,
  empty,
  isEmpty,
}: DataPanelProps) {
  const showPagination = page != null && pageSize != null && total != null && onPageChange != null && total > 0;
  const showEmpty = isEmpty && empty;

  return (
    <div
      className="panel data-panel"
    >
      {/* Header */}
      <div className="data-panel__header">
        <SectionHeader variant="secondary" title={title} trailing={trailing} />
      </div>

      {/* Content or Empty */}
      {showEmpty ? (
        <div className="data-panel__empty">
          <EmptyState icon={empty.icon} title={empty.title} description={empty.description} action={empty.action} />
        </div>
      ) : (
        <div className="data-panel__body">{children}</div>
      )}

      {/* Pagination */}
      {showPagination && !showEmpty && (
        <Pagination page={page} pageSize={pageSize} total={total} onChange={onPageChange} />
      )}
    </div>
  );
}
