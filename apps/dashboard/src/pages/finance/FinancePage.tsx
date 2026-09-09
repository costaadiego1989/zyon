import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  Landmark,
  LoaderCircle,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  WalletCards,
} from "lucide-react";
import {
  createDashboardApi,
  type FinanceSummary,
  type FinanceTransaction,
  type FinanceTransactionKind,
  type FinanceTransactionsPage,
  type MerchantProfile,
} from "../../api-client.js";
import { DashboardHttpError } from "../../api/http/error.js";
import { Button } from "../../components/Button.js";
import { DataPanel } from "../../components/DataPanel.js";
import { FilterSelect, FilterToolbar } from "../../components/FilterToolbar.js";
import { PageLoader } from "../../components/PageLoader.js";
import { SidePanel } from "../../components/SidePanel.js";
import { TabBar } from "../../components/TabBar.js";
import { showToast } from "../../components/Toast.js";

import { PeriodFilter } from "../../components/PeriodFilter.js";
import { StatCard, StatCardGroup } from "../overview/components/StatCard.js";
import "./finance-page.css";

type FinanceTab = "overview" | "transactions" | "reports";
type RangePreset = "today" | "7d" | "15d" | "30d" | "custom";
type TransactionFilter = "all" | FinanceTransactionKind;

const PAGE_SIZE = 25;
const MAIN_TABS = [
  { key: "overview", label: "Visão geral" },
  { key: "transactions", label: "Transações" },
  { key: "reports", label: "Relatórios" },
];
const PERIOD_TABS = [
  { key: "today", label: "Hoje" },
  { key: "7d", label: "Últimos 7 dias" },
  { key: "15d", label: "Últimos 15 dias" },
  { key: "30d", label: "Últimos 30 dias" },
  { key: "custom", label: "Personalizado" },
];

export function FinancePage({ apiBaseUrl, me }: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: apiBaseUrl }), [apiBaseUrl]);
  const initialRange = useMemo(() => rangeFor("30d"), []);
  const [tab, setTab] = useState<FinanceTab>("overview");
  const [preset, setPreset] = useState<RangePreset>("30d");
  const [from, setFrom] = useState(initialRange.from);
  const [to, setTo] = useState(initialRange.to);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<FinanceTransactionsPage | null>(null);
  const [transactionsLoading, setTransactionsLoading] = useState(false);
  const [transactionsError, setTransactionsError] = useState<string | null>(null);
  const [transactionFilter, setTransactionFilter] = useState<TransactionFilter>("all");
  const [method, setMethod] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<FinanceTransaction | null>(null);
  const [exporting, setExporting] = useState(false);

  const period = useMemo(() => ({ from, to }), [from, to]);
  const loadSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      setSummary(await api.getFinanceSummary(period));
    } catch (caught) {
      setSummaryError(displayError(caught, "Não foi possível carregar os dados financeiros."));
    } finally {
      setSummaryLoading(false);
    }
  }, [api, period]);
  const loadTransactions = useCallback(async () => {
    setTransactionsLoading(true);
    setTransactionsError(null);
    try {
      setTransactions(await api.getFinanceTransactions({
        ...period,
        page,
        limit: PAGE_SIZE,
        type: transactionFilter,
        method: method || undefined,
        q: search || undefined,
      }));
    } catch (caught) {
      setTransactionsError(displayError(caught, "Não foi possível carregar as transações."));
    } finally {
      setTransactionsLoading(false);
    }
  }, [api, method, page, period, search, transactionFilter]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);
  useEffect(() => { if (tab === "transactions") void loadTransactions(); }, [loadTransactions, tab]);

  const applyPreset = (next: RangePreset) => {
    setPreset(next);
    if (next === "custom") return;
    const range = rangeFor(next);
    setFrom(range.from);
    setTo(range.to);
    setPage(1);
  };
  const editDate = (field: "from" | "to", value: string) => {
    setPreset("custom");
    field === "from" ? setFrom(value) : setTo(value);
    setPage(1);
  };
  const availableMethods = useMemo(
    () => summary?.payment_methods.map((entry) => ({ value: entry.method, label: entry.method })) ?? [],
    [summary],
  );
  const downloadCsv = async () => {
    setExporting(true);
    try {
      const response = await api.getFinanceCsv(period);
      if (!response.ok) throw new DashboardHttpError(response.status, await response.text());
      const blob = await response.blob();
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `financeiro-${from}-${to}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(href);
      showToast("success", "Relatório CSV baixado.");
    } catch (caught) {
      showToast("error", displayError(caught, "Não foi possível gerar o relatório."));
    } finally {
      setExporting(false);
    }
  };

  if (!me) return null;
  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">LOJA</span>
          <h1>Financeiro</h1>
          <p className="page-lead">Acompanhe vendas concluídas e reembolsos confirmados da sua loja.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void downloadCsv()} disabled={exporting}>
          {exporting ? <LoaderCircle size={14} /> : <Download size={14} />} Exportar CSV
        </Button>
      </header>

      <PeriodFilter presets={PERIOD_TABS} active={preset} onPreset={(next) => applyPreset(next as RangePreset)} from={from} to={to} onDate={editDate}
        action={<Button variant="outline" size="sm" onClick={() => { void loadSummary(); if (tab === "transactions") void loadTransactions(); }} disabled={summaryLoading || transactionsLoading}><RefreshCw size={14} /> Atualizar</Button>} />
      <div className="finance-page__tabs">
        <TabBar tabs={MAIN_TABS} activeTab={tab} onTabChange={(next) => setTab(next as FinanceTab)} />
        {summary?.period ? <PeriodLabel period={summary.period} /> : null}
      </div>
      {summaryError ? <ErrorPanel message={summaryError} onRetry={loadSummary} /> : null}
      {tab === "overview" && (summaryLoading ? <PageLoader /> : summary ? <Overview summary={summary} onTransactions={() => setTab("transactions")} /> : null)}
      {tab === "transactions" && <Transactions summary={summary} loading={transactionsLoading} error={transactionsError} result={transactions} type={transactionFilter} onType={(value) => { setTransactionFilter(value); setPage(1); }} method={method} onMethod={(value) => { setMethod(value); setPage(1); }} methods={availableMethods} search={search} onSearch={(value) => { setSearch(value); setPage(1); }} onPage={setPage} onRetry={loadTransactions} onSelect={setSelected} />}
      {tab === "reports" && <Reports period={summary?.period} exporting={exporting} onExport={downloadCsv} />}
      <SidePanel isOpen={Boolean(selected)} title={selected?.kind === "refund" ? "Reembolso confirmado" : "Venda concluída"} onClose={() => setSelected(null)}>{selected ? <TransactionDetails transaction={selected} /> : null}</SidePanel>
    </div>
  );
}

function Overview({ summary, onTransactions }: { summary: FinanceSummary; onTransactions: () => void }) {
  const { metrics } = summary;
  return <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
    <StatCardGroup primary>
      <StatCard primary icon={<WalletCards size={18} />} label="Vendas confirmadas" value={formatBrl(metrics.sales_confirmed_brl)} note={`${metrics.completed_orders} pedido${metrics.completed_orders === 1 ? "" : "s"} concluído${metrics.completed_orders === 1 ? "" : "s"}`} />
      <StatCard icon={<ReceiptText size={16} />} label="Pedidos concluídos" value={formatInteger(metrics.completed_orders)} note="No período selecionado" />
      <StatCard icon={<BarChart3 size={16} />} label="Ticket médio" value={formatBrl(metrics.average_order_value_brl)} note="Por pedido concluído" />
      <StatCard accent="var(--color-error)" icon={<RotateCcw size={16} />} label="Reembolsos confirmados" value={formatBrl(metrics.refunds_confirmed_brl)} note="Processados pelo provedor" />
    </StatCardGroup>
    <p style={{ margin: 0, padding: "12px 14px", borderRadius: 10, background: "var(--color-brand-subtle)", border: "1px solid var(--color-brand-ring)", color: "var(--color-text-muted)", font: "12.5px/1.55 var(--font-sans)" }}><Landmark size={15} style={{ verticalAlign: "-3px", marginRight: 7, color: "var(--color-brand)" }} />{summary.scope_note}</p>
    <div className="finance-page__columns">
      <section className="panel" style={{ padding: 0, overflow: "hidden" }}><PanelHeader eyebrow="EVOLUÇÃO" title="Entradas e reembolsos" note="Valores em reais" /><RevenueChart points={summary.series} /></section>
      <section className="panel" style={{ padding: 0, overflow: "hidden" }}><PanelHeader eyebrow="PAGAMENTOS" title="Meios de pagamento" /><PaymentMethods items={summary.payment_methods} /></section>
    </div>
    <section className="panel" style={{ padding: 0, overflow: "hidden" }}>
      <PanelHeader eyebrow="CONFERÊNCIA" title="Cada valor pode ser conferido" trailing={<Button variant="outline" size="sm" onClick={onTransactions}>Ver transações</Button>} />
      <div className="finance-page__explainers">
        <Explainer icon={<CheckCircle2 size={16} />} title="Vendas concluídas" text="Cada pedido aparece uma vez no relatório, com o total registrado na compra." />
        <Explainer icon={<RotateCcw size={16} />} title="Reembolsos separados" text="Reembolsos parciais e totais entram somente após a confirmação do provedor." />
        <Explainer icon={<Landmark size={16} />} title="Repasses depois" text="Saldo disponível, taxa e previsão de repasse entram quando houver conciliação." />
      </div>
    </section>
  </div>;
}

function Transactions(props: { summary: FinanceSummary | null; loading: boolean; error: string | null; result: FinanceTransactionsPage | null; type: TransactionFilter; onType: (value: TransactionFilter) => void; method: string; onMethod: (value: string) => void; methods: Array<{ value: string; label: string }>; search: string; onSearch: (value: string) => void; onPage: (page: number) => void; onRetry: () => Promise<void>; onSelect: (transaction: FinanceTransaction) => void }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
    <section className="panel" style={{ padding: 0, overflow: "hidden" }}><FilterToolbar tabs={[{ key: "all", label: "Todas" }, { key: "sale", label: "Vendas" }, { key: "refund", label: "Reembolsos" }]} activeTab={props.type} onTabChange={(next) => props.onType(next as TransactionFilter)} search={props.search} onSearchChange={props.onSearch} searchPlaceholder="Buscar pedido ou método..." extra={<FilterSelect value={props.method} onChange={props.onMethod} placeholder="Todos os métodos" width={190} options={props.methods} />} /></section>
    {props.error ? <ErrorPanel message={props.error} onRetry={props.onRetry} /> : null}
    <DataPanel title="Movimentações financeiras" trailing={props.result ? <span style={{ color: "var(--color-text-faint)", font: "12px var(--font-sans)" }}>{props.result.total} registro{props.result.total === 1 ? "" : "s"}</span> : undefined} page={props.result?.page ?? 1} pageSize={props.result?.limit ?? PAGE_SIZE} total={props.result?.total ?? 0} onPageChange={props.onPage} isEmpty={!props.loading && Boolean(props.result) && props.result?.items.length === 0} empty={{ icon: ReceiptText, title: "Nenhuma movimentação neste período", description: "Quando houver pedidos concluídos ou reembolsos confirmados, eles aparecerão aqui." }}>
      {props.loading ? <PageLoader /> : <div style={{ overflowX: "auto" }}><table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}><caption className="sr-only">Movimentações financeiras da loja</caption><thead><tr>{["DATA", "TIPO", "PEDIDO", "MÉTODO", "SITUAÇÃO", "VALOR"].map((label) => <th key={label} style={tableHeaderStyle}>{label}</th>)}</tr></thead><tbody>{props.result?.items.map((transaction) => <TransactionRow key={transaction.id} transaction={transaction} onClick={() => props.onSelect(transaction)} />)}</tbody></table></div>}
    </DataPanel>
  </div>;
}

function Reports({ period, exporting, onExport }: { period?: { from: string; to: string; time_zone: string }; exporting: boolean; onExport: () => Promise<void> }) {
  return <div className="finance-page__columns">
    <section className="panel" style={{ padding: 0, overflow: "hidden" }}><PanelHeader eyebrow="RELATÓRIO DISPONÍVEL" title="Movimentações financeiras" trailing={<FileSpreadsheet size={20} color="var(--color-brand)" />} /><div style={{ padding: "0 20px 22px" }}><p style={{ margin: "0 0 16px", color: "var(--color-text-muted)", font: "13px/1.6 var(--font-sans)", maxWidth: 560 }}>Baixe todas as vendas concluídas e os reembolsos confirmados do período selecionado. O arquivo traz valores em BRL, método de pagamento e referência do pedido.</p><Button variant="primary" onClick={() => void onExport()} disabled={exporting}>{exporting ? <LoaderCircle size={15} /> : <Download size={15} />}{exporting ? "Gerando relatório..." : "Baixar CSV"}</Button></div></section>
    <section className="panel" style={{ padding: 20 }}><span style={kickerStyle}>ESCOPO DO ARQUIVO</span><div style={{ display: "grid", gap: 12, marginTop: 14 }}><ReportDetail label="Período" value={period ? `${formatDateOnly(period.from)} até ${formatDateOnly(period.to)}` : "Carregando..."} /><ReportDetail label="Fuso" value={period?.time_zone ?? "America/Sao_Paulo"} /><ReportDetail label="Moeda" value="BRL (R$)" /><ReportDetail label="Cobertura" value="Pedidos concluídos e reembolsos confirmados" /></div></section>
  </div>;
}

function PanelHeader({ eyebrow, title, note, trailing }: { eyebrow: string; title: string; note?: string; trailing?: React.ReactNode }) { return <div style={panelHeaderStyle}><div><span style={kickerStyle}>{eyebrow}</span><h2 style={panelTitleStyle}>{title}</h2></div>{trailing ?? (note ? <span style={{ font: "12px var(--font-sans)", color: "var(--color-text-faint)" }}>{note}</span> : null)}</div>; }
function RevenueChart({ points }: { points: FinanceSummary["series"] }) { if (points.length === 0) return <EmptyChart />; const width = 760; const height = 240; const pad = { top: 20, right: 20, bottom: 32, left: 52 }; const max = Math.max(...points.flatMap((point) => [point.sales_brl, point.refunds_brl]), 1); const x = (index: number) => pad.left + (index / Math.max(points.length - 1, 1)) * (width - pad.left - pad.right); const y = (value: number) => height - pad.bottom - (value / max) * (height - pad.top - pad.bottom); const pathFor = (read: (point: FinanceSummary["series"][number]) => number) => points.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(read(point))}`).join(" "); return <div style={{ padding: "8px 18px 16px" }}><svg viewBox={`0 0 ${width} ${height}`} width="100%" height={240} role="img" aria-label="Evolução de vendas e reembolsos no período">{[0, .5, 1].map((factor) => <g key={factor}><line x1={pad.left} x2={width - pad.right} y1={y(max * factor)} y2={y(max * factor)} stroke="var(--color-border)" strokeDasharray="4 6" /><text x={pad.left - 9} y={y(max * factor) + 4} textAnchor="end" fill="var(--color-text-faint)" fontSize="10" fontFamily="var(--font-mono)">{formatCompactBrl(max * factor)}</text></g>)}<path d={pathFor((point) => point.sales_brl)} fill="none" stroke="var(--color-brand)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />{points.some((point) => point.refunds_brl > 0) ? <path d={pathFor((point) => point.refunds_brl)} fill="none" stroke="var(--color-error)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /> : null}{points.map((point, index) => <text key={point.date} x={x(index)} y={height - 10} textAnchor="middle" fill="var(--color-text-faint)" fontSize="10" fontFamily="var(--font-mono)">{shortDate(point.date)}</text>)}</svg><div style={{ display: "flex", gap: 16, padding: "0 4px", color: "var(--color-text-muted)", font: "11px var(--font-sans)" }}><Legend color="var(--color-brand)" label="Vendas" /><Legend color="var(--color-error)" label="Reembolsos" /></div></div>; }
function PaymentMethods({ items }: { items: FinanceSummary["payment_methods"] }) { if (items.length === 0) return <EmptyChart message="Os métodos aparecem depois das primeiras vendas concluídas." />; const total = items.reduce((sum, item) => sum + item.sales_brl, 0) || 1; return <div style={{ padding: "0 20px 20px", display: "grid", gap: 14 }}>{items.map((item) => <div key={item.method}><div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 7 }}><span style={{ color: "var(--color-text)", font: "600 13px var(--font-sans)" }}>{item.method}</span><span style={{ color: "var(--color-text-muted)", font: "12px var(--font-mono)" }}>{formatBrl(item.sales_brl)} · {item.orders} pedido{item.orders === 1 ? "" : "s"}</span></div><div style={{ height: 6, borderRadius: 99, background: "var(--surface-3)", overflow: "hidden" }}><div style={{ height: "100%", width: `${Math.max(3, (item.sales_brl / total) * 100)}%`, borderRadius: "inherit", background: "var(--color-brand)" }} /></div></div>)}</div>; }
function TransactionRow({ transaction, onClick }: { transaction: FinanceTransaction; onClick: () => void }) { const refund = transaction.kind === "refund"; return <tr onClick={onClick} style={{ cursor: "pointer" }} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") onClick(); }}><td style={tableCellStyle}>{formatDateTime(transaction.occurred_at)}</td><td style={tableCellStyle}><MovementBadge kind={transaction.kind} /></td><td style={{ ...tableCellStyle, color: "var(--color-text)", fontWeight: 600 }}>{transaction.order_reference}</td><td style={tableCellStyle}>{transaction.payment_method ?? "Não informado"}</td><td style={tableCellStyle}><StatusBadge kind={transaction.kind} status={transaction.status} /></td><td style={{ ...tableCellStyle, color: refund ? "var(--color-error)" : "var(--color-brand)", textAlign: "right", font: "700 13px var(--font-mono)" }}>{refund ? "−" : "+"}{formatBrl(Math.abs(transaction.amount_brl))}</td></tr>; }
function TransactionDetails({ transaction }: { transaction: FinanceTransaction }) { const refund = transaction.kind === "refund"; return <div style={{ display: "grid", gap: 18 }}><div style={{ padding: 16, borderRadius: 10, border: "1px solid var(--color-border)", background: "var(--surface-2)" }}><span style={kickerStyle}>{refund ? "SAÍDA CONFIRMADA" : "ENTRADA CONFIRMADA"}</span><strong style={{ display: "block", marginTop: 10, color: refund ? "var(--color-error)" : "var(--color-brand)", font: "700 29px var(--font-mono)" }}>{refund ? "−" : "+"}{formatBrl(Math.abs(transaction.amount_brl))}</strong></div><div style={{ display: "grid", gap: 14 }}><Detail label="Data" value={formatDateTime(transaction.occurred_at)} /><Detail label="Pedido" value={transaction.order_reference} /><Detail label="Método" value={transaction.payment_method ?? "Não informado"} /><Detail label="Situação" value={<StatusBadge kind={transaction.kind} status={transaction.status} />} /><Detail label="Referência do pagamento" value={transaction.payment_intent_id ?? "Não informado"} mono /></div><p style={{ margin: 0, padding: 12, borderRadius: 9, background: "var(--surface-2)", color: "var(--color-text-faint)", font: "12px/1.55 var(--font-sans)" }}>{refund ? "O valor foi incluído após a confirmação do reembolso pelo provedor." : "O valor corresponde ao total registrado no pedido concluído."}</p></div>; }
function PeriodLabel({ period }: { period: { from: string; to: string; time_zone: string } }) { return <span style={{ color: "var(--color-text-faint)", font: "11px var(--font-mono)" }}>{formatDateOnly(period.from)} a {formatDateOnly(period.to)} · {period.time_zone}</span>; }
function ErrorPanel({ message, onRetry }: { message: string; onRetry: () => Promise<void> }) { return <div role="alert" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, padding: "12px 16px", borderRadius: 10, border: "1px solid var(--color-error)", background: "var(--color-error-bg)", color: "var(--color-error)", font: "13px var(--font-sans)" }}><span>{message}</span><Button variant="outline" size="sm" onClick={() => void onRetry()}>Tentar novamente</Button></div>; }
function MovementBadge({ kind }: { kind: FinanceTransactionKind }) { const refund = kind === "refund"; return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 8px", borderRadius: 999, color: refund ? "var(--color-error)" : "var(--color-brand)", background: refund ? "var(--color-error-bg)" : "var(--color-brand-subtle)", font: "700 10.5px var(--font-mono)" }}>{refund ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />}{refund ? "Reembolso" : "Venda"}</span>; }
function StatusBadge({ kind, status }: { kind: FinanceTransactionKind; status: string }) { return <span style={{ display: "inline-flex", minHeight: 23, alignItems: "center", padding: "0 8px", borderRadius: 999, color: kind === "refund" ? "var(--color-error)" : "var(--color-success)", background: kind === "refund" ? "var(--color-error-bg)" : "var(--color-success-bg)", font: "700 10px var(--font-mono)" }}>{kind === "refund" ? "Confirmado" : humanStatus(status)}</span>; }
function Detail({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) { return <div style={{ display: "grid", gap: 5 }}><span style={kickerStyle}>{label}</span><span style={{ color: "var(--color-text)", font: mono ? "12px var(--font-mono)" : "13px var(--font-sans)", overflowWrap: "anywhere" }}>{value}</span></div>; }
function ReportDetail({ label, value }: { label: string; value: string }) { return <div style={{ display: "grid", gap: 4, paddingBottom: 11, borderBottom: "1px solid var(--color-border)" }}><span style={kickerStyle}>{label}</span><span style={{ color: "var(--color-text)", font: "13px var(--font-sans)" }}>{value}</span></div>; }
function Explainer({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <div style={{ padding: 14, border: "1px solid var(--color-border)", borderRadius: 10, background: "var(--surface-2)" }}><span style={{ color: "var(--color-brand)", display: "inline-flex" }}>{icon}</span><h3 style={{ margin: "9px 0 5px", color: "var(--color-text)", font: "600 13px var(--font-sans)" }}>{title}</h3><p style={{ margin: 0, color: "var(--color-text-faint)", font: "12px/1.5 var(--font-sans)" }}>{text}</p></div>; }
function Legend({ color, label }: { color: string; label: string }) { return <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><i aria-hidden style={{ width: 8, height: 8, borderRadius: 99, background: color }} />{label}</span>; }
function EmptyChart({ message = "Ainda não há movimentações neste período." }: { message?: string }) { return <div style={{ minHeight: 210, display: "grid", placeItems: "center", padding: 20, color: "var(--color-text-faint)", font: "13px var(--font-sans)", textAlign: "center" }}>{message}</div>; }
function rangeFor(preset: Exclude<RangePreset, "custom">): { from: string; to: string } { const to = toSaoPauloDate(new Date()); if (preset === "today") return { from: to, to }; const days = preset === "7d" ? 6 : preset === "15d" ? 14 : 29; return { from: addDays(to, -days), to }; }
function toSaoPauloDate(date: Date): string { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date); const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ""; return `${value("year")}-${value("month")}-${value("day")}`; }
function addDays(value: string, days: number): string { const [year, month, day] = value.split("-").map(Number); return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10); }
function formatBrl(value: number): string { return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value); }
function formatInteger(value: number): string { return new Intl.NumberFormat("pt-BR").format(value); }
function formatCompactBrl(value: number): string { return value >= 1000 ? `R$ ${(value / 1000).toFixed(value >= 10000 ? 0 : 1)}k` : formatBrl(value); }
function formatDateOnly(value: string): string { const [year, month, day] = value.split("-"); return year && month && day ? `${day}/${month}/${year}` : value; }
function formatDateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }); }
function shortDate(value: string): string { const [, month, day] = value.split("-"); return month && day ? `${day}/${month}` : value; }
function humanStatus(status: string): string { const lowered = status.toLowerCase(); return ["approved", "paid", "succeeded", "captured"].includes(lowered) ? "Concluído" : status; }
function displayError(error: unknown, fallback: string): string { if (error instanceof DashboardHttpError) { if (error.status === 403) return "Sua conta não tem permissão para acessar o Financeiro."; if (error.status === 0) return "Não foi possível conectar ao servidor. Verifique sua conexão."; } return fallback; }

const kickerStyle: React.CSSProperties = { color: "var(--color-text-faint)", font: "600 10px var(--font-mono)", letterSpacing: "0.07em", textTransform: "uppercase" };
const panelHeaderStyle: React.CSSProperties = { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 14, padding: "20px 20px 16px" };
const panelTitleStyle: React.CSSProperties = { margin: "6px 0 0", color: "var(--color-text)", font: "600 16px var(--font-sans)", letterSpacing: "-0.01em" };
const tableHeaderStyle: React.CSSProperties = { textAlign: "left", padding: "10px 20px", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-faint)", font: "600 10px var(--font-mono)", letterSpacing: "0.05em" };
const tableCellStyle: React.CSSProperties = { padding: "14px 20px", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-muted)", font: "13px var(--font-sans)", verticalAlign: "middle" };
