import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
const businessDayFormat = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',era:'short'});
const businessInstantFormat = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23',timeZoneName:'longOffset'});
function validBusinessDay(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number(value.slice(0,4))>=1 && Number(value.slice(0,4))<9999 && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10)===value;
}
/** First actual instant of a civil day; midnight can be skipped by historic DST. */
function businessBoundary(value: string) {
  let low=Date.parse(value)-36*3600000,high=Date.parse(value)+36*3600000;
  while(low<high){
    const middle=Math.floor((low+high)/2),parts=businessDayFormat.formatToParts(middle);
    const part=(type:string)=>parts.find(p=>p.type===type)!.value;
    const day=`${part('era')==='BC'?'-':''}${part('year').padStart(4,'0')}-${part('month')}-${part('day')}`;
    if(day<value)low=middle+1;else high=middle;
  }
  return low;
}
function businessInstant(value:number) {
  const parts=businessInstantFormat.formatToParts(value),part=(type:string)=>parts.find(p=>p.type===type)!.value;
  const offset=part('timeZoneName').replace('GMT',''),milliseconds=new Date(value).getUTCMilliseconds();
  if(!/^[+-]\d{2}:\d{2}$/.test(offset))return new Date(value).toISOString();
  return `${part('year').padStart(4,'0')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}${milliseconds?`.${String(milliseconds).padStart(3,'0')}`:''}${offset}`;
}
export function cashbackPeriodQuery(from: string, to: string) {
  if(!validBusinessDay(from)||!validBusinessDay(to)||from>to)return {from:'',to:''};
  const next=new Date(Date.parse(to)+86400000).toISOString().slice(0,10);
  return {from:businessInstant(businessBoundary(from)),to:businessInstant(businessBoundary(next)-1)};
}

type ConfigurationOperation = { kind: "save" | "publish"; command: CashbackConfigurationWrite; rules?: CashbackDraft };

export function useCashbackPage(scopeKey = "cashback") {
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
  const lifetime = useRef(new AbortController());
  const programRead = useRef(0);
  const canonical = useRef<CashbackProgramView | null>(null);
  const reviewed = useRef<CashbackProgramView | null>(null);
  const operation = useRef<ConfigurationOperation | null>(null);
  const [reviewedProgram, setReviewedProgram] = useState<CashbackProgramView | null>(null);
  const [needsReconciliation, setNeedsReconciliation] = useState(false);
  const validPeriod = validBusinessDay(period.from) && validBusinessDay(period.to) && period.from <= period.to;
  const dates = useMemo(()=>cashbackPeriodQuery(period.from, period.to),[period.from,period.to]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(customerQuery.trim()), 250);
    return () => clearTimeout(timer);
  }, [customerQuery]);
  useEffect(() => {
    contextEpoch.current++;
    lifetime.current = new AbortController(); programRead.current++;
    canonical.current = null; reviewed.current = null; operation.current = null;
    setReviewedProgram(null); setNeedsReconciliation(false);
    setProgram(emptyResource()); setMetrics(emptyResource()); setCustomers(emptyResource()); setTransactions(emptyResource()); setWallet(emptyResource());
    setSelectedCustomer(null); setActionError(null); setNotice(null);
    mutationInFlight.current = null; setBusy(null);
    return () => { contextEpoch.current++; lifetime.current.abort(); };
  }, [api, scopeKey]);
  function acceptProgram(data: CashbackProgramView) {
    canonical.current = data;
    if (reviewed.current?.configurationRevision !== data.configurationRevision) { reviewed.current = null; setReviewedProgram(null); }
    setProgram({data,loading:false,error:null});
  }
  async function refreshProgram() {
    const epoch = contextEpoch.current, request = ++programRead.current;
    const data = await api.getCashbackProgram(lifetime.current.signal);
    if (epoch !== contextEpoch.current || request !== programRead.current) return null;
    acceptProgram(data); return data;
  }
  useEffect(() => {
    let cancelled = false;
    setProgram(value => ({ ...value, loading: true, error: null }));
    refreshProgram().then(() => undefined)
      .catch(() => { if (!cancelled) setProgram({ data: null, loading: false, error: FAILURE }); });
    return () => { cancelled = true; };
  }, [api, scopeKey, revision]);
  useEffect(() => {
    if (tab !== "overview" || !validPeriod) return;
    let cancelled = false; const controller = new AbortController();
    setMetrics(value => ({ ...value, loading: true, error: null }));
    api.getCashbackMetrics(dates, controller.signal).then(data => { if (!cancelled) setMetrics({ data, loading: false, error: null }); })
      .catch(() => { if (!cancelled) setMetrics({ data: null, loading: false, error: FAILURE }); });
    return () => { cancelled = true; controller.abort(); };
  }, [api, scopeKey, tab, period.from, period.to, validPeriod, revision]);
  useEffect(() => {
    if (tab !== "customers") return;
    let cancelled = false; const controller = new AbortController();
    setCustomers(value => ({ ...value, loading: true, error: null }));
    api.getCashbackCustomers({ q: debouncedQuery, filter: customerFilter, page: customerPage, pageSize }, controller.signal).then(data => {
      if (cancelled) return;
      const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
      if (customerPage > lastPage) { setCustomerPage(lastPage); return; }
      setCustomers({ data, loading: false, error: null });
    }).catch(() => { if (!cancelled) setCustomers({ data: null, loading: false, error: FAILURE }); });
    return () => { cancelled = true; controller.abort(); };
  }, [api, scopeKey, tab, debouncedQuery, customerFilter, customerPage, revision]);
  useEffect(() => {
    if (!selectedCustomer) return;
    let cancelled = false; const controller = new AbortController();
    setWallet(emptyResource());
    api.getCashbackCustomer(selectedCustomer.buyerId, controller.signal).then(data => { if (!cancelled) setWallet({ data, loading: false, error: null }); })
      .catch(() => { if (!cancelled) setWallet({ data: null, loading: false, error: FAILURE }); });
    return () => { cancelled = true; controller.abort(); };
  }, [api, scopeKey, selectedCustomer?.buyerId, revision]);
  useEffect(() => {
    if ((tab !== "transactions" && !selectedCustomer) || !validPeriod) return;
    let cancelled = false; const controller = new AbortController();
    setTransactions(value => ({ ...value, loading: true, error: null }));
    api.getCashbackTransactions({ ...dates, buyerId: selectedCustomer?.buyerId, type: transactionType, page: transactionPage, pageSize }, controller.signal).then(data => {
      if (cancelled) return;
      const lastPage = Math.max(1, Math.ceil(data.total / pageSize));
      if (transactionPage > lastPage) { setTransactionPage(lastPage); return; }
      setTransactions({ data, loading: false, error: null });
    }).catch(() => { if (!cancelled) setTransactions({ data: null, loading: false, error: FAILURE }); });
    return () => { cancelled = true; controller.abort(); };
  }, [api, scopeKey, tab, selectedCustomer?.buyerId, transactionType, transactionPage, period.from, period.to, validPeriod, revision]);

  const reload = useCallback(() => setRevision(value => value + 1), []);
  async function mutate<T>(name: string, action: () => Promise<T>, message: string): Promise<T | null> {
    if (mutationInFlight.current || (operation.current && name !== operation.current.kind && name !== "reconcile")) return null;
    const mutationToken = Symbol(name);
    mutationInFlight.current = mutationToken;
    const epoch = contextEpoch.current;
    setBusy(name); setActionError(null); setNotice(null);
    try {
      const result = await action();
      if (epoch !== contextEpoch.current) return null;
      setNotice(message); if (!["save", "publish", "review", "reconcile"].includes(name)) reload(); return result;
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
  function invalidateReview() { reviewed.current = null; setReviewedProgram(null); }
  async function reviewDraft() {
    if (operation.current || mutationInFlight.current) return null;
    const result = await mutate("review", refreshProgram, "Confira as regras salvas antes de publicar.");
    if (result?.configurationRevision) { reviewed.current = structuredClone(result); setReviewedProgram(reviewed.current); setTab("settings"); }
    return result;
  }
  async function runConfiguration(op: ConfigurationOperation) {
    const epoch = contextEpoch.current;
    let failureStatus: number | undefined;
    const result = await mutate(op.kind, async () => {
      try {
        const receipt = op.kind === "save" ? await api.saveCashbackDraft(op.rules!, op.command, lifetime.current.signal) : await api.publishCashbackProgram(op.command, lifetime.current.signal);
        if (epoch !== contextEpoch.current) return null;
        // Durable receipts can contain old snapshots. Always read canonical state.
        await refreshProgram();
        if (epoch === contextEpoch.current) { operation.current = null; setNeedsReconciliation(false); invalidateReview(); }
        return receipt;
      } catch (error) {
        if (epoch !== contextEpoch.current) throw error;
        const status = (error as {status?:number}).status;
        failureStatus = status;
        if (status && status >= 400 && status < 500 && status !== 408) {
          operation.current = null; setNeedsReconciliation(false); invalidateReview();
          if (status === 409) { try { await refreshProgram(); } catch { /* Keep conflict visible even if readback fails. */ } }
        } else setNeedsReconciliation(true);
        throw error;
      }
    }, op.kind === "save" ? "Rascunho salvo. O programa só muda quando você publica." : "Cashback publicado. As novas regras valem para os próximos pedidos elegíveis.");
    if (epoch === contextEpoch.current && !result) {
      if (operation.current) setActionError("Não foi possível confirmar a operação. Confira o resultado antes de uma nova escrita.");
      else setActionError(failureStatus === 409 ? "As regras podem ter sido alteradas. Seus campos foram mantidos. Carregue o rascunho atual e revise novamente." : failureStatus === 403 ? "Sua conta não tem permissão para esta alteração." : "Não foi possível concluir a operação. Seus campos foram mantidos; confira as regras e tente novamente.");
    }
    return result;
  }
  async function saveDraft(rules: CashbackDraft, expectedRevision = canonical.current?.configurationRevision) {
    if (operation.current || mutationInFlight.current) return null;
    if (!expectedRevision) { setActionError("Atualize as regras antes de continuar."); return null; }
    invalidateReview();
    const op: ConfigurationOperation = {kind:"save",rules:structuredClone(rules),command:{expectedRevision,idempotencyKey:createIdempotencyKey()}};
    operation.current = op; return runConfiguration(op);
  }
  async function publish(_rules?: CashbackRules) {
    if (operation.current || mutationInFlight.current) return null;
    if (!reviewed.current?.configurationRevision) { setActionError("Revise o rascunho salvo antes de publicar."); return null; }
    const op: ConfigurationOperation = {kind:"publish",command:{expectedRevision:reviewed.current.configurationRevision,idempotencyKey:createIdempotencyKey()}};
    operation.current = op; return runConfiguration(op);
  }
  async function retryConfiguration() {
    const op = operation.current, epoch = contextEpoch.current;
    if (!op || mutationInFlight.current) return null;
    const current = await mutate("reconcile", refreshProgram, "Resultado consultado.");
    if (!current || epoch !== contextEpoch.current) return null;
    return runConfiguration(op);
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
    const epoch = contextEpoch.current;
    return mutate("export", async () => {
      const blob = await api.exportCashback(kind === "customers" ? { kind, q: debouncedQuery, filter: customerFilter } : { kind, ...dates, buyerId: selectedCustomer?.buyerId, type: transactionType });
      if (epoch !== contextEpoch.current) return false;
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
    customerQuery, setCustomerQuery: (next: string) => { setCustomerQuery(next); if (!next.trim()) setDebouncedQuery(""); setCustomerPage(1); }, customerFilter,
    setCustomerFilter: (next: CashbackCustomerFilter) => { setCustomerFilter(next); setCustomerPage(1); },
    customerPage, setCustomerPage, transactionPage, setTransactionPage, transactionType,
    setTransactionType: (next: string) => { setTransactionType(next); setTransactionPage(1); }, selectedCustomer, selectCustomer,
    pageSize, busy, actionError, notice, clearActionError: () => setActionError(null), reload, saveDraft, publish, pause, end, adjust, exportCsv,
    reviewedProgram, needsReconciliation, reviewDraft, invalidateReview, retryConfiguration, refreshProgram,
  };
}
