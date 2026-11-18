import { useCallback, useEffect, useRef, useState } from "react";
import type { CashbackConfigurationWrite, CashbackCustomer, CashbackDraft, CashbackMetrics, CashbackPage, CashbackProgramView, CashbackRules, CashbackTransaction, CashbackWalletView } from "@zyon/shared-types";
import { useApi } from "../../hooks/useApi.js";
import type { CashbackCustomerFilter } from "../../api/endpoints/cashback.js";
import { createIdempotencyKey } from "../../api/http/idempotency.js";

export type CashbackTab = "overview" | "settings" | "customers" | "transactions";
export type CashbackPeriodPreset = "month" | "today" | "7d" | "15d" | "30d";
interface Resource<T> { data: T | null; loading: boolean; error: string | null; }
const emptyResource = <T,>(): Resource<T> => ({ data: null, loading: true, error: null });
const FAILURE = "Não foi possível carregar estas informações. Tente novamente.";
const pageSize = 10;

/** Date-only inputs are business dates in São Paulo, not the browser's timezone. */
function localDate(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function cashbackInitialPeriod(now = new Date()) {
  return cashbackPresetPeriod("month", now);
}
export function cashbackPresetPeriod(preset: CashbackPeriodPreset, now = new Date()) {
  const to = localDate(now);
  if (preset === "month") return { from: `${to.slice(0, 8)}01`, to };
  const days = preset === "today" ? 1 : Number(preset.slice(0, -1));
  // Subtract calendar days from the business date, independently of the browser timezone.
  const firstDay = new Date(`${to}T12:00:00Z`);
  firstDay.setUTCDate(firstDay.getUTCDate() - days + 1);
  return { from: firstDay.toISOString().slice(0, 10), to };
}
export function cashbackPeriodQuery(from: string, to: string) {
  return { from: `${from}T00:00:00-03:00`, to: `${to}T23:59:59.999-03:00` };
}

export function useCashbackPage() {
  const api = useApi();
  const [tab, setTab] = useState<CashbackTab>("overview");
  const [program, setProgram] = useState<Resource<CashbackProgramView>>(emptyResource);
  const [metrics, setMetrics] = useState<Resource<CashbackMetrics>>(emptyResource);
  const [customers, setCustomers] = useState<Resource<CashbackPage<CashbackCustomer>>>(emptyResource);
  const [transactions, setTransactions] = useState<Resource<CashbackPage<CashbackTransaction>>>(emptyResource);
  const [wallet, setWallet] = useState<Resource<CashbackWalletView>>(emptyResource);
  const [period, setPeriod] = useState(cashbackInitialPeriod);
  const [periodPreset, setPeriodPreset] = useState<CashbackPeriodPreset | "custom">("month");
  const [customerQuery, setCustomerQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [customerFilter, setCustomerFilter] = useState<CashbackCustomerFilter>("all");
  const [customerPage, setCustomerPage] = useState(1);
  const [transactionPage, setTransactionPage] = useState(1);
  const [transactionType, setTransactionType] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<CashbackCustomer | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mutationInFlight = useRef<symbol | null>(null);
  const contextEpoch = useRef(0);
  const validPeriod = /^\d{4}-\d{2}-\d{2}$/.test(period.from) && /^\d{4}-\d{2}-\d{2}$/.test(period.to) && period.from <= period.to;
  const dates = cashbackPeriodQuery(period.from, period.to);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(customerQuery.trim()), 250);
    return () => clearTimeout(timer);
  }, [customerQuery]);
  useEffect(() => {
    contextEpoch.current++;
    setProgram(emptyResource()); setMetrics(emptyResource()); setCustomers(emptyResource()); setTransactions(emptyResource()); setWallet(emptyResource());
    setSelectedCustomer(null); setActionError(null); setNotice(null);
    mutationInFlight.current = null; setBusy(null);
    return () => { contextEpoch.current++; };
  }, [api]);
  useEffect(() => {
    let cancelled = false;
    setProgram(value => ({ ...value, loading: true, error: null }));
    api.getCashbackProgram().then(data => { if (!cancelled) setProgram({ data, loading: false, error: null }); })
      .catch(() => { if (!cancelled) setProgram({ data: null, loading: false, error: FAILURE }); });
    return () => { cancelled = true; };
  }, [api, revision]);
  useEffect(() => {
    if (tab !== "overview" || !validPeriod) return;
    let cancelled = false;
    setMetrics(value => ({ ...value, loading: true, error: null }));
    api.getCashbackMetrics(dates).then(data => { if (!cancelled) setMetrics({ data, loading: false, error: null }); })
      .catch(() => { if (!cancelled) setMetrics({ data: null, loading: false, error: FAILURE }); });
    return () => { cancelled = true; };
  }, [api, tab, period.from, period.to, validPeriod, revision]);
  useEffect(() => {
    if (tab !== "customers") return;
    let cancelled = false;
    setCustomers(value => ({ ...value, loading: true, error: null }));
    api.getCashbackCustomers({ q: debouncedQuery, filter: customerFilter, page: customerPage, pageSize }).then(data => {
      if (cancelled) return;
      const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
      if (customerPage > lastPage) { setCustomerPage(lastPage); return; }
      setCustomers({ data, loading: false, error: null });
    }).catch(() => { if (!cancelled) setCustomers({ data: null, loading: false, error: FAILURE }); });
    return () => { cancelled = true; };
  }, [api, tab, debouncedQuery, customerFilter, customerPage, revision]);
  useEffect(() => {
    if (!selectedCustomer) return;
    let cancelled = false;
    setWallet(emptyResource());
    api.getCashbackCustomer(selectedCustomer.buyerId).then(data => { if (!cancelled) setWallet({ data, loading: false, error: null }); })
      .catch(() => { if (!cancelled) setWallet({ data: null, loading: false, error: FAILURE }); });
    return () => { cancelled = true; };
  }, [api, selectedCustomer?.buyerId, revision]);
  useEffect(() => {
    if ((tab !== "transactions" && !selectedCustomer) || !validPeriod) return;
    let cancelled = false;
    setTransactions(value => ({ ...value, loading: true, error: null }));
    api.getCashbackTransactions({ ...dates, buyerId: selectedCustomer?.buyerId, type: transactionType, page: transactionPage, pageSize }).then(data => {
      if (cancelled) return;
      const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
      if (transactionPage > lastPage) { setTransactionPage(lastPage); return; }
      setTransactions({ data, loading: false, error: null });
    }).catch(() => { if (!cancelled) setTransactions({ data: null, loading: false, error: FAILURE }); });
    return () => { cancelled = true; };
  }, [api, tab, selectedCustomer?.buyerId, transactionType, transactionPage, period.from, period.to, validPeriod, revision]);

  const reload = useCallback(() => setRevision(value => value + 1), []);
  async function mutate<T>(name: string, action: () => Promise<T>, message: string): Promise<T | null> {
    if (mutationInFlight.current) return null;
    const mutationToken = Symbol(name);
    mutationInFlight.current = mutationToken;
    const epoch = contextEpoch.current;
    setBusy(name); setActionError(null); setNotice(null);
    try {
      const result = await action();
      if (epoch !== contextEpoch.current) return null;
      setNotice(message); reload(); return result;
    } catch (error) {
      if (epoch === contextEpoch.current) {
        const text = error instanceof Error ? error.message : "";
        setActionError(text.includes("403") ? "Sua conta não tem permissão para esta alteração." : "Não foi possível concluir a operação. Seus dados foram mantidos; confira a conexão e tente novamente.");
      }
      return null;
    } finally {
      if (mutationInFlight.current === mutationToken) mutationInFlight.current = null;
      if (epoch === contextEpoch.current) setBusy(null);
    }
  }
  function configurationWrite(view: CashbackProgramView | null): CashbackConfigurationWrite {
    if (!view?.configurationRevision) throw new Error("Atualize as regras antes de continuar.");
    return { expectedRevision: view.configurationRevision, idempotencyKey: createIdempotencyKey() };
  }
  async function saveDraft(rules: CashbackDraft) {
    const result = await mutate("save", () => api.saveCashbackDraft(rules, configurationWrite(program.data)), "Rascunho salvo. O programa só muda quando você publica.");
    if (result) setProgram({ data: result, loading: false, error: null });
    return result;
  }
  async function publish(rules: CashbackRules) {
    const result = await mutate("publish", async () => {
      const saved = await api.saveCashbackDraft(rules, configurationWrite(program.data));
      return api.publishCashbackProgram(configurationWrite(saved));
    }, "Cashback publicado. As novas regras valem para os próximos pedidos elegíveis.");
    if (result) setProgram({ data: result, loading: false, error: null });
    return result;
  }
  async function pause() {
    const result = await mutate("pause", () => api.pauseCashbackProgram(), "Novos ganhos pausados. Os créditos existentes continuam sendo honrados.");
    if (result) setProgram({ data: result, loading: false, error: null });
    return result;
  }
  async function end() {
    const result = await mutate("end", () => api.endCashbackProgram(), "Programa encerrado para novos ganhos. O saldo existente permanece registrado e utilizável conforme suas condições.");
    if (result) setProgram({ data: result, loading: false, error: null });
    return result;
  }
  async function adjust(input: { amountCents: number; reason: string; idempotencyKey: string; expiryDays?: number | null }) {
    if (!selectedCustomer) return null;
    const buyerId = selectedCustomer.buyerId;
    const result = await mutate("adjust", () => api.adjustCashbackCustomer(buyerId, input), "Ajuste registrado no extrato com motivo e identificação do operador.");
    if (result) setWallet({ data: result, loading: false, error: null });
    return result;
  }
  async function exportCsv(kind: "customers" | "transactions") {
    return mutate("export", async () => {
      const blob = await api.exportCashback(kind === "customers" ? { kind, q: debouncedQuery, filter: customerFilter } : { kind, ...dates, buyerId: selectedCustomer?.buyerId, type: transactionType });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a"); link.href = url; link.download = `cashback-${kind === "customers" ? "clientes" : "extrato"}-${localDate(new Date())}.csv`;
      document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      return true;
    }, "Exportação preparada com os filtros selecionados.");
  }
  function selectCustomer(customer: CashbackCustomer | null) {
    setSelectedCustomer(customer); setTransactionPage(1); setTransactionType(""); setActionError(null); setNotice(null);
  }
  return {
    tab, setTab, program, metrics, customers, transactions, wallet, period, periodPreset, validPeriod,
    setPeriod: (next: typeof period) => { setPeriod(next); setPeriodPreset("custom"); setTransactionPage(1); },
    setPeriodPreset: (next: CashbackPeriodPreset) => { setPeriod(cashbackPresetPeriod(next)); setPeriodPreset(next); setTransactionPage(1); },
    customerQuery, setCustomerQuery: (next: string) => { setCustomerQuery(next); setCustomerPage(1); }, customerFilter,
    setCustomerFilter: (next: CashbackCustomerFilter) => { setCustomerFilter(next); setCustomerPage(1); },
    customerPage, setCustomerPage, transactionPage, setTransactionPage, transactionType,
    setTransactionType: (next: string) => { setTransactionType(next); setTransactionPage(1); }, selectedCustomer, selectCustomer,
    pageSize, busy, actionError, notice, clearActionError: () => setActionError(null), reload, saveDraft, publish, pause, end, adjust, exportCsv,
  };
}
