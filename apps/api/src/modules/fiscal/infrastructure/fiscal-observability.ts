import { Counter, type Registry } from "prom-client";
import { safelyObserveFiscal, type FiscalObservationPort, type FiscalObservationScope } from "../domain/fiscal-observation.port.js";

const providers = new Set(["focus", "bling", "omie", "tiny"]);
const environments = new Set(["homologation", "production"]);
const documents = new Set(["authorized", "rejected", "reconciliation_required", "action_required", "cancelled"]);
const stocks = new Set(["evidence_pending", "evidence_confirmed", "released"]);
const channels = new Set(["email", "whatsapp"]);
const transports = new Set(["resend", "meta", "twilio", "provider", "unconfigured"]);
const deliveries = new Set(["blocked", "accepted", "delivered", "failed", "delivery_unknown"]);
const validScope = (value: FiscalObservationScope) => providers.has(value.provider) && environments.has(value.environment);

/** Bounded operational outcomes only. Actor/order/time audit stays in fiscal_events. */
export class FiscalObservability implements FiscalObservationPort {
  private readonly documents: Counter;
  private readonly stocks: Counter;
  private readonly deliveries: Counter;
  constructor(registry: Registry, private readonly logger?: { info(value: object, message: string): void }) {
    this.documents = new Counter({ name: "fiscal_documents_total", help: "Committed fiscal document state transitions", labelNames: ["provider", "environment", "outcome"], registers: [registry] });
    this.stocks = new Counter({ name: "fiscal_stock_total", help: "Fiscal stock evidence and committed barrier release outcomes", labelNames: ["provider", "environment", "outcome"], registers: [registry] });
    this.deliveries = new Counter({ name: "fiscal_deliveries_total", help: "Persisted fiscal message delivery outcomes, separate from invoice authorization", labelNames: ["provider", "environment", "channel", "transport", "outcome"], registers: [registry] });
  }
  private log(code: string, value: FiscalObservationScope, outcome: string, channel?: string, transport?: string) {
    safelyObserveFiscal(() => this.logger?.info({ code, provider: value.provider, environment: value.environment, outcome, ...(channel ? { channel, transport } : {}) }, "fiscal.outcome"));
  }
  transition(value: Parameters<FiscalObservationPort["transition"]>[0]): void {
    if (!validScope(value)) return;
    if (value.previousState !== value.state && documents.has(value.state)) {
      this.documents.inc({ provider: value.provider, environment: value.environment, outcome: value.state });
      this.log("fiscal_document_transition", value, value.state);
    }
    if (value.state === "authorized" && value.reasonCode?.startsWith("fiscal_stock_") && value.previousReasonCode !== value.reasonCode)
      this.stock({ provider: value.provider, environment: value.environment, outcome: "evidence_pending" });
  }
  stock(value: Parameters<FiscalObservationPort["stock"]>[0]): void {
    if (!validScope(value) || !stocks.has(value.outcome)) return;
    this.stocks.inc({ provider: value.provider, environment: value.environment, outcome: value.outcome });
    this.log("fiscal_stock_outcome", value, value.outcome);
  }
  delivery(value: Parameters<FiscalObservationPort["delivery"]>[0]): void {
    const transport = value.transport ?? "unconfigured";
    if (!validScope(value) || !channels.has(value.channel) || !transports.has(transport) || !deliveries.has(value.outcome)) return;
    this.deliveries.inc({ provider: value.provider, environment: value.environment, channel: value.channel, transport, outcome: value.outcome });
    this.log("fiscal_delivery_outcome", value, value.outcome, value.channel, transport);
  }
}
