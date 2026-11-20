import type { CashbackAssistantReport } from "@zyon/shared-types";
import { CashbackError } from "../domain/cashback.js";
import type { CashbackQueriesService } from "./cashback-queries.service.js";

const timeZone = "America/Sao_Paulo" as const;
const format = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
function day(instant: Date | number): string {
  const parts = format.formatToParts(instant); return ["year", "month", "day"].map(type => parts.find(p => p.type === type)!.value).join("-");
}
function validDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0, 4)) >= 1 && Number(value.slice(0, 4)) < 9999
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
/** First actual instant of an IANA civil day, including skipped DST midnight. */
function boundary(value: string): number {
  let low = Date.parse(value) - 36 * 3600000, high = Date.parse(value) + 36 * 3600000;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (day(middle) < value) low = middle + 1; else high = middle; }
  return low;
}
export class CashbackAssistantReportService {
  constructor(private readonly queries: Pick<CashbackQueriesService, "metrics">, private readonly clock: () => Date = () => new Date()) {}
  async read(merchantId: string, input: unknown = {}): Promise<CashbackAssistantReport> {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => !["from", "to"].includes(k))) throw new CashbackError("cashback_report_period_invalid");
    const args = input as { from?: unknown; to?: unknown }, explicit = Object.hasOwn(args, "from") || Object.hasOwn(args, "to");
    const today = day(this.clock()), from = explicit ? args.from : `${today.slice(0, 7)}-01`, to = explicit ? args.to : today;
    if (!validDay(from) || !validDay(to) || from > to) throw new CashbackError("cashback_report_period_invalid");
    const next = new Date(Date.parse(to) + 86400000).toISOString().slice(0, 10), start = boundary(from), end = boundary(next) - 1;
    if (end - start > 366 * 86400000) throw new CashbackError("cashback_report_period_invalid");
    try {
      // Preserve the canonical query's automatic lifecycle reconciliation. The
      // model gets no discretion to grant/adjust/expire funds or change rules.
      const metrics = await this.queries.metrics(merchantId, { from: new Date(start).toISOString(), to: new Date(end).toISOString() });
      return { merchantId, currency: "BRL", timeZone, budgetMonth: day(new Date(metrics.asOf)).slice(0, 7), metrics };
    } catch (error) {
      if (error instanceof CashbackError && ["cashback_date_invalid", "cashback_period_invalid"].includes(error.code)) throw new CashbackError("cashback_report_period_invalid");
      throw new CashbackError("cashback_report_unavailable", 503);
    }
  }
}
