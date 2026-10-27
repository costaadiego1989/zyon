import { createHash } from "node:crypto";

/** Fixed operational catalog. No provider text or customer labels enter notices. */
export const MARKETPLACE_OPERATIONAL_ALERT_SEVERITIES = {
  MarketplaceJobStalled: "warning", MarketplaceJobFailures: "warning", MarketplaceCatalogRepairIncomplete: "warning",
  MarketplacePaymentStockHeld: "warning", MarketplaceFundingHeld: "critical", MarketplaceTransfersOverdue: "critical",
  MarketplaceMetricsStale: "warning", MarketplaceMetricsMissing: "warning", MarketplacePayoutOutcomeUnknown: "critical",
  MarketplacePayoutPlanMissing: "critical", MarketplacePayoutPendingTooLong: "warning", MarketplacePayoutFailed: "critical",
  MarketplaceCaptureAllocationDelayed: "warning", MarketplaceFinancialEventDead: "critical", MarketplaceRefundReconciliationDelayed: "critical",
  MarketplaceRefundBlocked: "warning", MarketplaceFinancialEventsDelayed: "critical", MarketplaceRecoveryOutcomeUnknown: "critical",
  MarketplaceResidualHeld: "critical", MarketplaceRecoveryFailed: "warning", MarketplaceCarrierRefundUnproven: "warning",
  MarketplaceDebtReconciliationDelayed: "warning", MarketplaceDebtPrincipalExtinctionUnproven: "critical",
  PurchaseHistoryTelemetryDropped: "warning", StorefrontConversationHistoryFailed: "warning",
  MarketplacePaymentResumeFailed: "warning", OutboxRelayUnavailable: "critical", OutboxRelayDispatchStalled: "critical", OutboxRelayErrors: "warning",
  MarketplaceAlertmanagerUnavailable: "critical", MarketplaceAlertDeliveryFailed: "critical", MarketplaceAlertDeliveryPipelineMissing: "critical",
  MarketplaceOperationalNotificationFailed: "critical", MarketplaceOperationalNotificationDelayed: "warning",
  MarketplaceOperationalNotificationMetricsStale: "warning",
  MarketplaceRefundFundingDelayed: "warning", MarketplaceWalletReturnOutcomeUnknown: "critical",
  MarketplaceWalletReturnFailed: "warning", MarketplaceRefundFundingMetricsStale: "warning",
  MarketplaceShippingFinancialReconciliationRequired: "warning", MarketplaceShippingFinancialMetricsStale: "warning",
  MarketplaceContributionCollectionDelayed: "warning", MarketplaceContributionExcessOutcomeUnknown: "critical",
  MarketplaceContributionCollectionMetricsStale: "warning",
  MarketplaceHostFeeCollectionDelayed: "warning", MarketplaceHostFeeExcessHeld: "warning",
  MarketplaceHostDisputeMetricsStale: "warning",
} as const;
export type OperationalAlertName = keyof typeof MARKETPLACE_OPERATIONAL_ALERT_SEVERITIES;
export type OperationalAlertChannel = "email" | "whatsapp" | "dashboard";
export interface MarketplaceOperationalAlert {
  id: string; merchantId: string; alertName: OperationalAlertName; fingerprint: string; startsAt: Date;
  state: "firing" | "resolved"; severity: "warning" | "critical"; dimensions: Record<string, string>;
}
export interface OperationalAlertDeliveryClaim {
  id: string; channel: OperationalAlertChannel; attempts: number; leaseToken: string; leaseUntil: Date; alert: MarketplaceOperationalAlert;
}
export interface OperationalAlertDeliveryResult {
  status: "accepted" | "retryable_failed" | "failed" | "unknown";
  reason?: string; providerMessageId?: string;
}
export type PreparedOperationalAlertDelivery = OperationalAlertDeliveryResult | { send(): Promise<OperationalAlertDeliveryResult> };
const DIMENSIONS = new Set(["job", "worker", "provider", "status", "event_type", "party", "reason", "operation", "cluster", "environment", "namespace", "phase", "integration", "kind", "scope", "outcome", "channel"]);

export function parseMarketplaceOperationalAlerts(payload: unknown, merchantId: string, now = new Date()): MarketplaceOperationalAlert[] {
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(merchantId)) throw new Error("operational_alert_destination_unavailable");
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || JSON.stringify(payload).length > 131072) throw new Error("operational_alert_payload_invalid");
  const body = payload as Record<string, unknown>;
  if (body.version !== "4" || body.receiver !== "marketplace-operations" || body.truncatedAlerts !== 0 || !Array.isArray(body.alerts) || body.alerts.length < 1 || body.alerts.length > 100) throw new Error("operational_alert_payload_invalid");
  const byId = new Map<string, MarketplaceOperationalAlert>();
  for (const raw of body.alerts) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("operational_alert_payload_invalid");
    const row = raw as Record<string, any>, labels = row.labels;
    if (!labels || typeof labels !== "object" || Array.isArray(labels) || !Object.hasOwn(MARKETPLACE_OPERATIONAL_ALERT_SEVERITIES, labels.alertname) ||
      !["firing", "resolved"].includes(row.status) || typeof row.fingerprint !== "string" || !/^[a-f0-9]{16}$/.test(row.fingerprint) ||
      typeof row.startsAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(row.startsAt)) throw new Error("operational_alert_payload_invalid");
    const startsAt = new Date(row.startsAt), alertName = labels.alertname as OperationalAlertName;
    if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() > now.getTime() + 60000 || labels.severity !== MARKETPLACE_OPERATIONAL_ALERT_SEVERITIES[alertName]) throw new Error("operational_alert_payload_invalid");
    const dimensions: Record<string, string> = {};
    for (const key of Object.keys(labels).sort()) {
      if (!DIMENSIONS.has(key)) continue;
      const value = labels[key];
      if (typeof value !== "string" || !/^[A-Za-z0-9_.:-]{1,80}$/.test(value)) throw new Error("operational_alert_payload_invalid");
      dimensions[key] = value;
    }
    // Preserve nanosecond identity in the hash, while SQL stores a timestamp.
    const id = "ops_" + createHash("sha256").update(JSON.stringify([merchantId, alertName, row.fingerprint, row.startsAt, row.status])).digest("hex");
    byId.set(id, { id, merchantId, alertName, fingerprint: row.fingerprint, startsAt, state: row.status, severity: labels.severity, dimensions });
  }
  return [...byId.values()];
}

export function operationalAlertContent(alert: MarketplaceOperationalAlert) {
  const state = alert.state === "resolved" ? "resolvido" : "ativo";
  const hostContent = {
    MarketplaceHostFeeCollectionDelayed: {
      title: "Cobrança da taxa da loja principal pendente",
      body: "Consulte o pagamento existente em Taxas da loja principal. Aguarde a conciliação do recebimento antes de criar outra cobrança.",
    },
    MarketplaceHostFeeExcessHeld: {
      title: "Excedente da taxa da loja principal aguardando conciliação",
      body: "Há um valor recebido além da taxa devida. Esse excedente pertence à loja principal e mantém a obrigação aberta até sua conciliação.",
    },
    MarketplaceHostDisputeMetricsStale: {
      title: "Monitoramento financeiro da loja principal desatualizado",
      body: "Os últimos valores financeiros comprovados foram preservados. Restaure a atualização do monitoramento antes de concluir a conciliação.",
    },
  } as const;
  if (Object.hasOwn(hostContent, alert.alertName)) {
    const content=hostContent[alert.alertName as keyof typeof hostContent];
    return {title:`Marketplace: ${content.title} (${state})`,body:alert.state==="resolved"
      ? "A condição deste alerta operacional foi resolvida. Consulte a conciliação financeira para verificar as demais obrigações do pedido."
      : content.body};
  }
  return { title: `Marketplace: ${alert.alertName} ${state}`,
    body: `Alerta operacional ${state}, gravidade ${alert.severity === "critical" ? "crítica" : "atenção"}. Consulte a operação do marketplace antes de intervir.` };
}
