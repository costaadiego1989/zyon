import type { InterventionRecordedReason } from "../ports/checkout-intervention-ledger.port.js";

export interface InterventionRecordProps {
  merchantId: string;
  sessionId: string;
  occurredAtUnix: number;
  reason: InterventionRecordedReason;
}

/** Valida entrada antes de gravar no ledger append-only (regras mínimas de domínio). */
export function assertInterventionRecord(props: InterventionRecordProps): void {
  if (!props.merchantId?.trim()) {
    throw new Error("intervention_merchant_required");
  }
  if (!props.sessionId?.trim()) {
    throw new Error("intervention_session_required");
  }
  if (!Number.isFinite(props.occurredAtUnix)) {
    throw new Error("intervention_occurred_invalid");
  }
}
