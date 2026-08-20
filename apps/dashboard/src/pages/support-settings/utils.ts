/**
 * Support settings utilities.
 * Extracted for easier testing and modularity.
 */

import type { SupportFaqItem, SupportTicket } from "@zyon/shared-types";

export function formatPtBrDate(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) +
         " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

export function validateFaqItems(items: SupportFaqItem[]): Array<{ question: boolean; answer: boolean }> {
  return items.map((it) => ({
    question: !it.question.trim(),
    answer: !it.answer.trim(),
  }));
}

export function moveItemInList<T extends { id: string }>(
  items: T[],
  id: string,
  direction: "up" | "down",
): T[] {
  const idx = items.findIndex((it) => it.id === id);
  if (idx === -1) return items.slice();
  const swapWith = direction === "up" ? idx - 1 : idx + 1;
  if (swapWith < 0 || swapWith >= items.length) return items.slice();
  const next = items.slice();
  const a = next[idx]!;
  const b = next[swapWith]!;
  next[idx] = b;
  next[swapWith] = a;
  return next;
}

export function filterTickets<T extends { id: string; buyerMessage: string }>(
  tickets: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return tickets.slice();
  return tickets.filter(
    (t) =>
      t.id.toLowerCase().includes(q) ||
      (t.buyerMessage ?? "").toLowerCase().includes(q),
  );
}

export function paginateItems<T>(
  items: T[],
  page: number,
  pageSize: number,
): { paginated: T[]; hasMore: boolean } {
  const start = (page - 1) * pageSize;
  const paginated = items.slice(start, start + pageSize);
  const hasMore = start + paginated.length < items.length;
  return { paginated, hasMore };
}
