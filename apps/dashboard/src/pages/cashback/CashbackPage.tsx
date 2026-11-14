import { useState } from "react";
import type { CashbackBalance, CashbackMetrics, CashbackTransaction } from "@zyon/shared-types";
import { ArrowLeft, Download, Pause, Settings2, Undo2, Users, RefreshCw } from "lucide-react";
import { PageHeader } from "../../components/PageHeader.js";
import { Button } from "../../components/Button.js";
import { DataPanel } from "../../components/DataPanel.js";
import { EmptyState } from "../../components/EmptyState.js";
import { FilterToolbar, FilterSelect } from "../../components/FilterToolbar.js";
import { PeriodFilter } from "../../components/PeriodFilter.js";
import { TabBar } from "../../components/TabBar.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { createIdempotencyKey } from "../../api/http/idempotency.js";
import type { CashbackCustomerFilter } from "../../api/endpoints/cashback.js";
import { CashbackSettings } from "./CashbackSettings.js";
import { cashbackDate, cashbackDecimal, cashbackMoney, cashbackTransactionLabels } from "./cashback-form.js";
import { useCashbackPage } from "./useCashbackPage.js";
import type { CashbackPeriodPreset, CashbackTab } from "./useCashbackPage.js";
import "./cashback.css";

type ViewModel = ReturnType<typeof useCashbackPage>;
const programLabels = { disabled: "Não configurado", active: "Ativo", paused: "Novos ganhos pausados", ended: "Encerrado para novos ganhos" };

function Loading({ label = "Carregando informações de cashback…" }: { label?: string }) {
  return <div className="cashback-loading" role="status" aria-label={label}><span /><span /><span /><p>{label}</p></div>;
}
function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return <EmptyState icon={Undo2} title="Informações indisponíveis" description={message} action={<Button variant="outline" onClick={retry}>Tentar novamente</Button>} />;
}
function Balances({ balance }: { balance: Pick<CashbackBalance, "availableCents" | "pendingCents" | "reservedCents"> }) {
  return <dl className="cashback-balances" aria-label="Saldo atual de cashback"><div><dt>Disponível para usar</dt><dd>{cashbackMoney(balance.availableCents)}</dd></div><div><dt>Aguardando liberação</dt><dd>{cashbackMoney(balance.pendingCents)}</dd></div><div><dt>Reservado em compras</dt><dd>{cashbackMoney(balance.reservedCents)}</dd></div></dl>;
}
function Period({ vm }: { vm: ViewModel }) {
  return <div className="cashback-period">
    <PeriodFilter
      presets={[{ key: "month", label: "Este mês" }, { key: "today", label: "Hoje" }, { key: "7d", label: "Últimos 7 dias" }, { key: "15d", label: "Últimos 15 dias" }, { key: "30d", label: "Últimos 30 dias" }]}
      active={vm.periodPreset}
      onPreset={key => vm.setPeriodPreset(key as CashbackPeriodPreset)}
      from={vm.period.from} to={vm.period.to}
      onDate={(field, value) => vm.setPeriod({ ...vm.period, [field]: value })}
    />
    <p className="cashback-help">Datas e horários de Brasília</p>
    {!vm.validPeriod && <p className="cashback-field-error" role="alert">Selecione um período válido, com início anterior ou igual ao fim.</p>}
  </div>;
}
function Metrics({ data }: { data: CashbackMetrics }) {
  const movements = [
    ["Crédito gerado", data.grantedCents], ["Crédito liberado", data.releasedCents], ["Cashback utilizado", data.redeemedCents],
    ["Crédito restituído", data.restoredCents], ["Crédito expirado", data.expiredCents], ["Crédito estornado", data.reversedCents], ["Perda promocional", data.lossCents],
  ] as const;
  return <>
    <section className="panel cashback-current"><div className="cashback-section-heading"><div><h2>Saldo atual do programa</h2><p>Posição em {cashbackDate(data.asOf)}. Inclui créditos de períodos anteriores.</p></div></div><Balances balance={data} /></section>
    <div className="cashback-overview-columns">
      <section className="panel cashback-statements"><h2>Movimentações no período</h2><dl>{movements.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{cashbackMoney(value)}</dd></div>)}</dl></section>
      <section className="panel cashback-results"><h2>Clientes e compras no período</h2><dl>
        <div><dt>Clientes que ganharam</dt><dd>{data.buyersGranted}</dd></div><div><dt>Clientes que utilizaram</dt><dd>{data.buyersRedeemed}</dd></div>
        <div><dt>Pedidos com cashback</dt><dd>{data.ordersWithCashback}</dd></div><div><dt>Receita associada</dt><dd>{cashbackMoney(data.associatedRevenueCents)}</dd></div>
      </dl><p className="cashback-help">Receita dos pedidos em que houve uso de cashback. Não representa aumento de receita causado pelo programa.</p>
      <h3>Orçamento do mês</h3><dl><div><dt>Concedido</dt><dd>{cashbackMoney(data.budgetIssuedCents)}</dd></div><div><dt>Comprometido em compras</dt><dd>{cashbackMoney(data.budgetCommittedCents)}</dd></div><div><dt>Limite configurado</dt><dd>{data.budgetLimitCents === null ? "Sem limite" : cashbackMoney(data.budgetLimitCents)}</dd></div></dl></section>
    </div>
  </>;
}
function TransactionRows({ items }: { items: CashbackTransaction[] }) {
  return <div className="cashback-table-wrap"><table className="cashback-table"><thead><tr><th scope="col">Data</th><th scope="col">Movimentação</th><th scope="col">Valor</th><th scope="col">Pedido</th><th scope="col">Motivo</th></tr></thead><tbody>
    {items.map(item => <tr key={item.id}><td>{cashbackDate(item.occurredAt)}</td><td>{cashbackTransactionLabels[item.type] ?? item.type}</td><td className="cashback-amount">{cashbackMoney(item.amountCents)}</td><td className="cashback-reference">{item.orderId ?? "—"}</td><td>{item.reason}{item.actorId && <small>Operador: {item.actorId}</small>}</td></tr>)}
  </tbody></table></div>;
}
function Transactions({ vm }: { vm: ViewModel }) {
  return <div className="cashback-transactions"><Period vm={vm} /><DataPanel title={vm.selectedCustomer ? "Extrato do cliente" : "Extrato do programa"} page={vm.transactionPage} pageSize={vm.pageSize} total={vm.transactions.loading || vm.transactions.error ? 0 : vm.transactions.data?.total ?? 0} onPageChange={vm.setTransactionPage}
    trailing={<Button variant="outline" size="sm" loading={vm.busy === "export"} disabled={!!vm.busy || !vm.validPeriod || !vm.transactions.data?.total} onClick={() => void vm.exportCsv("transactions")}><Download size={14} /> Exportar extrato</Button>}>
    <FilterToolbar tabs={[]} activeTab="" onTabChange={() => {}} extra={<FilterSelect ariaLabel="Tipo de movimentação" value={vm.transactionType} onChange={vm.setTransactionType} options={[{ value: "", label: "Todas as movimentações" }, ...Object.entries(cashbackTransactionLabels).map(([value, label]) => ({ value, label }))]} />} />
    {!vm.validPeriod ? <p className="cashback-state">Corrija o período para consultar o extrato.</p> : vm.transactions.loading ? <Loading label="Carregando extrato…" /> : vm.transactions.error ? <ErrorState message={vm.transactions.error} retry={vm.reload} /> : !vm.transactions.data?.items.length ? <EmptyState icon={Undo2} title="Nenhuma movimentação neste período" description="Os créditos, usos, restituições e ajustes aparecerão aqui quando acontecerem. Confira o período e o tipo selecionado." /> : <TransactionRows items={vm.transactions.data.items} />}
  </DataPanel></div>;
}
function Adjustment({ vm }: { vm: ViewModel }) {
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [expiryChoice, setExpiryChoice] = useState("");
  const [expiryDays, setExpiryDays] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [review, setReview] = useState<{ amountCents: number; reason: string; idempotencyKey: string; expiryDays?: number | null } | null>(null);
  function prepare() {
    const value = cashbackDecimal(amount);
    if (!direction || value === null || value <= 0 || value > 1_000_000_000_000 || reason.trim().length < 10 || reason.length > 1000) { setError("Escolha o tipo, informe um valor maior que zero e um motivo entre 10 e 1.000 caracteres."); return; }
    if (direction === "debit" && value > (vm.wallet.data?.balance.availableCents ?? 0)) { setError("O débito não pode superar o saldo disponível. Valores reservados não podem ser removidos."); return; }
    if (direction === "credit" && (!expiryChoice || (expiryChoice === "days" && (!/^\d+$/.test(expiryDays) || Number(expiryDays) < 1 || Number(expiryDays) > 3650)))) { setError("Escolha sem vencimento ou informe uma validade de 1 a 3.650 dias."); return; }
    setError(null); vm.clearActionError();
    setReview({ amountCents: direction === "debit" ? -value : value, reason: reason.trim(), idempotencyKey: createIdempotencyKey(), ...(direction === "credit" ? { expiryDays: expiryChoice === "none" ? null : Number(expiryDays) } : {}) });
  }
  async function confirm() {
    if (!review) return;
    if (await vm.adjust(review)) { setReview(null); setOpen(false); setAmount(""); setReason(""); setExpiryDays(""); setDirection(""); setExpiryChoice(""); }
  }
  return <section className="panel cashback-adjustment"><div className="cashback-section-heading"><div><h2>Ajuste administrativo</h2><p>Correções geram um lançamento auditável. O histórico original é preservado.</p></div><Button variant="outline" disabled={!!vm.busy || vm.wallet.loading || !!vm.wallet.error} onClick={() => { setOpen(value => !value); setError(null); }}>{open ? "Fechar ajuste" : "Registrar ajuste"}</Button></div>
    {open && <form noValidate onSubmit={event => { event.preventDefault(); prepare(); }}><div className="cashback-fields">
      <label className="cashback-field">Tipo de ajuste<select value={direction} onChange={event => { setDirection(event.target.value); setReview(null); }} disabled={!!vm.busy}><option value="">Selecione</option><option value="credit">Adicionar crédito</option><option value="debit">Reduzir saldo disponível</option></select></label>
      <label className="cashback-field">Valor do ajuste (R$)<input value={amount} inputMode="decimal" onChange={event => { setAmount(event.target.value); setReview(null); }} disabled={!!vm.busy} /></label>
      {direction === "credit" && <><label className="cashback-field">Validade do ajuste<select value={expiryChoice} onChange={event => { setExpiryChoice(event.target.value); setReview(null); }} disabled={!!vm.busy}><option value="">Selecione</option><option value="none">Sem vencimento</option><option value="days">Definir prazo em dias</option></select></label>{expiryChoice === "days" && <label className="cashback-field">Validade do ajuste (dias)<input inputMode="numeric" value={expiryDays} onChange={event => { setExpiryDays(event.target.value); setReview(null); }} disabled={!!vm.busy} /></label>}</>}
    </div><label className="cashback-field">Motivo do ajuste<textarea value={reason} rows={3} maxLength={1000} onChange={event => { setReason(event.target.value); setReview(null); }} disabled={!!vm.busy} /></label>{error && <p role="alert" className="cashback-field-error">{error}</p>}<Button type="submit" variant="outline" disabled={!!vm.busy}>Revisar ajuste</Button></form>}
    <ConfirmDialog open={!!review} title="Confirmar ajuste de cashback?" description={review ? `${review.amountCents > 0 ? "Adicionar" : "Reduzir"} ${cashbackMoney(Math.abs(review.amountCents))} ${review.amountCents > 0 ? "na carteira" : "do saldo disponível"}. Motivo: ${review.reason}. O operador e o motivo serão registrados no extrato.` : undefined} confirmLabel="Registrar ajuste" variant={review && review.amountCents < 0 ? "danger" : "default"} busy={vm.busy === "adjust"} error={vm.actionError} onConfirm={() => void confirm()} onCancel={() => { if (!vm.busy) setReview(null); }} />
  </section>;
}
function Customers({ vm }: { vm: ViewModel }) {
  if (vm.selectedCustomer) return <div className="cashback-customer-detail">
    <Button variant="ghost" onClick={() => vm.selectCustomer(null)}><ArrowLeft size={16} /> Voltar aos clientes</Button>
    <section className="panel cashback-current"><div className="cashback-section-heading"><div><h2>{vm.selectedCustomer.displayName}</h2><p>{vm.selectedCustomer.email ?? "Contato não disponível"}</p></div></div>
      {vm.wallet.loading ? <Loading label="Carregando saldo do cliente…" /> : vm.wallet.error ? <ErrorState message={vm.wallet.error} retry={vm.reload} /> : vm.wallet.data && <><Balances balance={vm.wallet.data.balance} /><p className="cashback-detail-note">{vm.wallet.data.balance.nextExpiryAt ? `${cashbackMoney(vm.wallet.data.balance.nextExpiryCents)} vencem em ${cashbackDate(vm.wallet.data.balance.nextExpiryAt)}.` : "Nenhum saldo com vencimento próximo."} Total utilizado: {cashbackMoney(vm.wallet.data.balance.usedCents)}.</p></>}
    </section><Transactions vm={vm} /><Adjustment key={vm.selectedCustomer.buyerId} vm={vm} />
  </div>;
  return <DataPanel title="Clientes com cashback" page={vm.customerPage} pageSize={vm.pageSize} total={vm.customers.loading || vm.customers.error ? 0 : vm.customers.data?.total ?? 0} onPageChange={vm.setCustomerPage}
    trailing={<Button variant="outline" size="sm" loading={vm.busy === "export"} disabled={!!vm.busy || !vm.customers.data?.total} onClick={() => void vm.exportCsv("customers")}><Download size={14} /> Exportar clientes</Button>}>
    <FilterToolbar tabs={[{ key: "all", label: "Todos" }, { key: "has_balance", label: "Com saldo" }, { key: "never_used", label: "Nunca utilizaram" }, { key: "expiring", label: "A vencer" }, { key: "used", label: "Já utilizaram" }]} activeTab={vm.customerFilter} onTabChange={key => vm.setCustomerFilter(key as CashbackCustomerFilter)} search={vm.customerQuery} onSearchChange={vm.setCustomerQuery} searchPlaceholder="Buscar cliente por nome ou e-mail" />
    {vm.customers.loading ? <Loading label="Carregando clientes…" /> : vm.customers.error ? <ErrorState message={vm.customers.error} retry={vm.reload} /> : !vm.customers.data?.items.length ? <EmptyState icon={Users} title={vm.customerQuery || vm.customerFilter !== "all" ? "Nenhum cliente encontrado" : "Os clientes aparecerão após o primeiro crédito"} description="Acompanhe aqui quem ganhou, possui saldo ou já utilizou cashback nesta loja." action={vm.customerQuery || vm.customerFilter !== "all" ? <Button variant="outline" onClick={() => { vm.setCustomerQuery(""); vm.setCustomerFilter("all"); }}>Limpar filtros</Button> : undefined} /> : <div className="cashback-table-wrap"><table className="cashback-table"><thead><tr><th scope="col">Cliente</th><th scope="col">Disponível</th><th scope="col">Pendente</th><th scope="col">Reservado</th><th scope="col">Utilizado</th><th scope="col">Próximo vencimento</th><th scope="col">Último uso</th></tr></thead><tbody>{vm.customers.data.items.map(customer => <tr key={customer.buyerId}>
      <td><button type="button" className="cashback-customer-link" onClick={() => vm.selectCustomer(customer)}>{customer.displayName}</button>{customer.email && <small>{customer.email}</small>}</td>
      <td className="cashback-amount">{cashbackMoney(customer.balance.availableCents)}</td><td className="cashback-amount">{cashbackMoney(customer.balance.pendingCents)}</td><td className="cashback-amount">{cashbackMoney(customer.balance.reservedCents)}</td><td className="cashback-amount">{cashbackMoney(customer.balance.usedCents)}</td>
      <td>{customer.balance.nextExpiryAt ? <>{cashbackDate(customer.balance.nextExpiryAt)}<small>{cashbackMoney(customer.balance.nextExpiryCents)}</small></> : "—"}</td><td>{cashbackDate(customer.lastUsedAt)}</td>
    </tr>)}</tbody></table></div>}
  </DataPanel>;
}

export function CashbackPage() {
  const vm = useCashbackPage();
  const [confirmation, setConfirmation] = useState<"pause" | "end" | null>(null);
  function switchTab(tab: CashbackTab) { vm.selectCustomer(null); vm.setTab(tab); }
  async function confirm() {
    const result = confirmation === "pause" ? await vm.pause() : await vm.end();
    if (result) setConfirmation(null);
  }
  return <div className="page-container cashback-page">
    <PageHeader title="Cashback" description="Crédito para a próxima compra, com regras claras e saldo compartilhado entre site e WhatsApp." actions={<Button variant="outline" onClick={vm.reload} disabled={!!vm.busy || vm.program.loading}><RefreshCw size={16} /> Atualizar</Button>} />
    {vm.notice && <p role="status" className="cashback-feedback cashback-feedback--success">{vm.notice}</p>}
    {vm.actionError && !confirmation && <p role="alert" className="cashback-feedback cashback-feedback--error">{vm.actionError}</p>}
    {vm.program.data && <section className="cashback-program-state" aria-label="Situação do programa"><div><span className="cashback-status" data-active={vm.program.data.status === "active"}>{programLabels[vm.program.data.status]}</span><p>{vm.program.data.status === "active" ? `Regra publicada · versão ${vm.program.data.version}. Créditos já concedidos preservam as condições de origem.` : "Novos ganhos dependem de regras completas e publicação. Créditos existentes continuam sendo honrados."}</p></div><div className="cashback-state-actions">
      {vm.tab !== "settings" && <Button variant="outline" onClick={() => switchTab("settings")}><Settings2 size={16} /> Configurar regras</Button>}
      {vm.program.data.status === "active" && <Button variant="outline" disabled={!!vm.busy} onClick={() => { vm.clearActionError(); setConfirmation("pause"); }}><Pause size={16} /> Pausar novos ganhos</Button>}
      {vm.program.data.version > 0 && vm.program.data.status !== "ended" && vm.tab === "settings" && <Button variant="ghost" disabled={!!vm.busy} onClick={() => { vm.clearActionError(); setConfirmation("end"); }}>Encerrar novos ganhos</Button>}
    </div></section>}
    <TabBar tabs={[{ key: "overview", label: "Visão geral" }, { key: "settings", label: "Configuração" }, { key: "customers", label: "Clientes" }, { key: "transactions", label: "Extrato" }]} activeTab={vm.tab} onTabChange={key => switchTab(key as CashbackTab)} role="group" label="Seções de cashback" />
    {!vm.program.data ? vm.program.loading ? <Loading /> : vm.program.error ? <ErrorState message={vm.program.error} retry={vm.reload} /> : null : <>
      {vm.tab === "overview" && <div className="cashback-overview"><Period vm={vm} />{vm.program.data.status === "disabled" && <div className="cashback-introduction"><h2>Defina o motivo para o cliente voltar</h2><p>O programa começa desligado. Escolha quanto conceder, quando liberar e como o crédito poderá ser usado. Disponível em todos os planos.</p><Button onClick={() => switchTab("settings")}>Configurar cashback</Button></div>}
        {!vm.validPeriod ? <p className="cashback-state">Corrija o período para consultar os resultados.</p> : vm.metrics.loading ? <Loading label="Carregando métricas…" /> : vm.metrics.error ? <ErrorState message={vm.metrics.error} retry={vm.reload} /> : vm.metrics.data && <Metrics data={vm.metrics.data} />}
      </div>}
      <div hidden={vm.tab !== "settings"}><CashbackSettings program={vm.program.data} busy={vm.busy} onSave={vm.saveDraft} onPublish={vm.publish} /></div>
      {vm.tab === "customers" && <Customers vm={vm} />}
      {vm.tab === "transactions" && <Transactions vm={vm} />}
    </>}
    <ConfirmDialog open={!!confirmation} title={confirmation === "pause" ? "Pausar novos ganhos de cashback?" : "Encerrar o programa para novos ganhos?"} description={confirmation === "pause" ? "Novos pedidos deixarão de ganhar cashback. Créditos já prometidos ou concedidos, consulta, uso e estornos continuam disponíveis." : "Novos ganhos serão encerrados. Esta ação não apaga saldos nem histórico e mantém o uso dos créditos existentes conforme o regulamento. Comunique a mudança aos clientes."} confirmLabel={confirmation === "pause" ? "Pausar novos ganhos" : "Encerrar novos ganhos"} busy={vm.busy === confirmation} error={vm.actionError} onConfirm={() => void confirm()} onCancel={() => { if (!vm.busy) setConfirmation(null); }} />
  </div>;
}
