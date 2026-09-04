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
  const showPagination = page != null && pageSize != null && total != null && onPageChange != null && total > pageSize;
  const showEmpty = isEmpty && empty;

  return (
    <div
      className="panel"
      style={{ overflow: "hidden", padding: 0 }}
    >
      {/* Header */}
      <div style={{ padding: "20px 20px 0" }}>
        <SectionHeader variant="secondary" title={title} trailing={trailing} />
      </div>

      {/* Content or Empty */}
      {showEmpty ? (
        <div style={{ padding: "0 20px 24px" }}>
          <EmptyState icon={empty.icon} title={empty.title} description={empty.description} action={empty.action} />
        </div>
      ) : (
        children
      )}

      {/* Pagination */}
      {showPagination && !showEmpty && (
        <Pagination page={page} pageSize={pageSize} total={total} onChange={onPageChange} />
      )}
    </div>
  );
}
