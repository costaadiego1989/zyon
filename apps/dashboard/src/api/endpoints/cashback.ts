import type { CashbackConfigurationWrite, CashbackCustomer, CashbackDraft, CashbackMetrics, CashbackPage, CashbackProgramView, CashbackTransaction, CashbackWalletView } from "@zyon/shared-types";
import { dashboardFetch, dashboardJson } from "../http/client.js";
import { DashboardHttpError } from "../http/error.js";

export type CashbackCustomerFilter = "all" | "has_balance" | "never_used" | "expiring" | "used";
export interface CashbackListQuery {
  q?: string;
  filter?: CashbackCustomerFilter;
  buyerId?: string;
  type?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

function queryString(input: CashbackListQuery & { kind?: string }): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== "") query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

function configurationWrite(command: CashbackConfigurationWrite): CashbackConfigurationWrite {
  if (!command || !/^[a-f0-9]{64}$/.test(command.expectedRevision) || typeof command.idempotencyKey !== "string"
    || !command.idempotencyKey.trim() || command.idempotencyKey.length > 200) {
    throw new DashboardHttpError(400, "cashback_configuration_revision_required");
  }
  return { expectedRevision: command.expectedRevision, idempotencyKey: command.idempotencyKey };
}

export function cashbackEndpoints(base: string, f: typeof fetch) {
  const path = "/dashboard/cashback";
  return {
    getCashbackProgram(signal?: AbortSignal): Promise<CashbackProgramView> {
      return dashboardJson(base, `${path}/program`, { method: "GET", signal }, f);
    },
    async saveCashbackDraft(rules: CashbackDraft, command: CashbackConfigurationWrite, signal?: AbortSignal): Promise<CashbackProgramView> {
      const write = configurationWrite(command);
      return dashboardJson(base, `${path}/program`, { method: "PATCH", signal, jsonBody: { rules, ...write }, headers: { "Idempotency-Key": write.idempotencyKey } }, f);
    },
    async publishCashbackProgram(command: CashbackConfigurationWrite, signal?: AbortSignal): Promise<CashbackProgramView> {
      const write = configurationWrite(command);
      return dashboardJson(base, `${path}/program/publish`, { method: "POST", signal, jsonBody: write, headers: { "Idempotency-Key": write.idempotencyKey } }, f);
    },
    pauseCashbackProgram(): Promise<CashbackProgramView> {
      return dashboardJson(base, `${path}/program/pause`, { method: "POST" }, f);
    },
    endCashbackProgram(): Promise<CashbackProgramView> {
      return dashboardJson(base, `${path}/program/end`, { method: "POST" }, f);
    },
    getCashbackMetrics(query: Pick<CashbackListQuery, "from" | "to">, signal?: AbortSignal): Promise<CashbackMetrics> {
      return dashboardJson(base, `${path}/metrics${queryString(query)}`, { method: "GET", signal }, f);
    },
    getCashbackCustomers(query: CashbackListQuery, signal?: AbortSignal): Promise<CashbackPage<CashbackCustomer>> {
      return dashboardJson(base, `${path}/customers${queryString(query)}`, { method: "GET", signal }, f);
    },
    getCashbackCustomer(buyerId: string, signal?: AbortSignal): Promise<CashbackWalletView> {
      return dashboardJson(base, `${path}/customers/${encodeURIComponent(buyerId)}`, { method: "GET", signal }, f);
    },
    getCashbackTransactions(query: CashbackListQuery, signal?: AbortSignal): Promise<CashbackPage<CashbackTransaction>> {
      return dashboardJson(base, `${path}/transactions${queryString(query)}`, { method: "GET", signal }, f);
    },
    adjustCashbackCustomer(buyerId: string, input: { amountCents: number; reason: string; idempotencyKey: string; expiryDays?: number | null }): Promise<CashbackWalletView> {
      return dashboardJson(base, `${path}/customers/${encodeURIComponent(buyerId)}/adjustments`, { method: "POST", jsonBody: input, headers: { "Idempotency-Key": input.idempotencyKey } }, f);
    },
    async exportCashback(query: CashbackListQuery & { kind?: "customers" | "transactions" }): Promise<Blob> {
      const response = await dashboardFetch(base, `${path}/exports${queryString(query)}`, { method: "GET" }, f);
      if (!response.ok) throw new DashboardHttpError(response.status, await response.text());
      return response.blob();
    },
  };
}
