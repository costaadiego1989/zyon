export interface FiscalObservationScope {
  provider: "focus" | "bling" | "omie" | "tiny";
  environment: "homologation" | "production";
}
export interface FiscalObservationPort {
  transition(value: FiscalObservationScope & { previousState: string; state: string; previousReasonCode?: string | null; reasonCode?: string | null }): void;
  stock(value: FiscalObservationScope & { outcome: "evidence_pending" | "evidence_confirmed" | "released" }): void;
  delivery(value: FiscalObservationScope & { channel: string; transport: string | null; outcome: string }): void;
}
/** Diagnostics run after persistence and must never invalidate a committed result. */
export function safelyObserveFiscal(work: () => void): void {
  try { work(); } catch { /* No raw observer error reaches operational logs. */ }
}
