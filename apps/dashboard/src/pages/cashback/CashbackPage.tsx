import { ArrowLeft, CircleCheck, CircleDashed, Clock, Download, LayoutDashboard, ListFilter, MessageSquare, Pause, Receipt, RefreshCw, Settings2, Undo2, Users, Wallet } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { CashbackBalance, CashbackTransaction } from "@zyon/shared-types";

import { PageHeader } from "../../components/PageHeader.js";
import { Button } from "../../components/Button.js";
import { DataPanel } from "../../components/DataPanel.js";
import { EmptyState } from "../../components/EmptyState.js";
import { FilterToolbar, FilterSelect } from "../../components/FilterToolbar.js";
import { PeriodFilter } from "../../components/PeriodFilter.js";
import { TabBar } from "../../components/TabBar.js";
import { ConfirmDialog } from "../../components/ConfirmDialog.js";
import { FormField, FormSelect, FormTextarea } from "../../components/FormField.js";
import { RowActionMenu } from "../../components/RowActionMenu.js";
import { createIdempotencyKey } from "../../api/http/idempotency.js";
import type { CashbackCustomerFilter } from "../../api/endpoints/cashback.js";
import { CashbackSettings } from "./CashbackSettings.js";
import { CashbackOverview } from "./CashbackOverview.js";
import { CashbackAssistant } from "./CashbackAssistant.js";
import { cashbackDate, cashbackDecimal, cashbackMoney, cashbackTransactionLabels } from "./cashback-form.js";
import { useCashbackPage } from "./useCashbackPage.js";
import type { CashbackPeriodPreset, CashbackTab } from "./useCashbackPage.js";
import "./cashback.css";

type ViewModel = ReturnType<typeof useCashbackPage>;
const programLabels = { disabled: "Desligado", active: "Ativo", paused: "Novos ganhos pausados", ended: "Encerrado para novos ganhos" };

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
function TransactionRows({ items }: { items: CashbackTransaction[] }) {
  return <div className="cashback-table-wrap" role="region" aria-label="Tabela de movimentações" tabIndex={0}><table className="cashback-table"><thead><tr><th scope="col">Data</th><th scope="col">Movimentação</th><th scope="col" className="cashback-amount">Valor</th><th scope="col">Pedido</th><th scope="col">Motivo</th></tr></thead><tbody>
    {items.map(item => <tr key={item.id}><td>{cashbackDate(item.occurredAt)}</td><td>{cashbackTransactionLabels[item.type] ?? item.type}</td><td className="cashback-amount">{cashbackMoney(item.amountCents)}</td><td className="cashback-reference">{item.orderId ?? "—"}</td><td>{item.reason}{item.actorId && <small>Operador: {item.actorId}</small>}</td></tr>)}
  </tbody></table></div>;
}
function Transactions({ vm }: { vm: ViewModel }) {
  return <div className="cashback-transactions"><Period vm={vm} /><DataPanel title={vm.selectedCustomer ? "Extrato do cliente" : "Extrato do programa"} page={vm.transactionPage} pageSize={vm.pageSize} total={vm.transactions.loading || vm.transactions.error ? 0 : vm.transactions.data?.total ?? 0} onPageChange={vm.setTransactionPage}
    trailing={<Button variant="outline" size="sm" aria-label="Exportar extrato" loading={vm.busy === "export"} disabled={!!vm.busy || !vm.validPeriod || !vm.transactions.data?.total} onClick={() => void vm.exportCsv("transactions")}><Download size={14} aria-hidden="true"/>Exportar extrato</Button>}>
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
      <FormSelect label="Tipo de ajuste" value={direction} onChange={value=>{setDirection(value);setReview(null);}} disabled={!!vm.busy} options={[{value:'',label:'Selecione'},{value:'credit',label:'Adicionar crédito'},{value:'debit',label:'Reduzir saldo disponível'}]}/>
      <FormField label="Valor do ajuste (R$)" value={amount} inputProps={{inputMode:'decimal'}} onChange={value=>{setAmount(value);setReview(null);}} disabled={!!vm.busy}/>
      {direction === "credit" && <><FormSelect label="Validade do ajuste" value={expiryChoice} onChange={value=>{setExpiryChoice(value);setReview(null);}} disabled={!!vm.busy} options={[{value:'',label:'Selecione'},{value:'none',label:'Sem vencimento'},{value:'days',label:'Definir prazo em dias'}]}/>{expiryChoice === "days" && <FormField label="Validade do ajuste (dias)" inputProps={{inputMode:'numeric'}} value={expiryDays} onChange={value=>{setExpiryDays(value);setReview(null);}} disabled={!!vm.busy}/>}</>}
    </div><FormTextarea label="Motivo do ajuste" value={reason} rows={3} maxLength={1000} onChange={value=>{setReason(value);setReview(null);}} disabled={!!vm.busy}/>{error && <p role="alert" className="cashback-field-error">{error}</p>}<Button type="submit" variant="outline" disabled={!!vm.busy}>Revisar ajuste</Button></form>}
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
    <FilterToolbar tabs={[{ key: "all", label: "Todos", icon: <ListFilter size={16} /> }, { key: "has_balance", label: "Com saldo", icon: <Wallet size={16} /> }, { key: "never_used", label: "Nunca utilizaram", icon: <CircleDashed size={16} /> }, { key: "expiring", label: "A vencer", icon: <Clock size={16} /> }, { key: "used", label: "Já utilizaram", icon: <CircleCheck size={16} /> }]} activeTab={vm.customerFilter} onTabChange={key => vm.setCustomerFilter(key as CashbackCustomerFilter)} search={vm.customerQuery} onSearchChange={vm.setCustomerQuery} searchPlaceholder="Buscar cliente por nome ou e-mail" />
    {vm.customers.loading ? <Loading label="Carregando clientes…" /> : vm.customers.error ? <ErrorState message={vm.customers.error} retry={vm.reload} /> : !vm.customers.data?.items.length ? <EmptyState icon={Users} title={vm.customerQuery || vm.customerFilter !== "all" ? "Nenhum cliente encontrado" : "Os clientes aparecerão após o primeiro crédito"} description="Acompanhe aqui quem ganhou, possui saldo ou já utilizou cashback nesta loja." action={vm.customerQuery || vm.customerFilter !== "all" ? <Button variant="outline" onClick={() => { vm.setCustomerQuery(""); vm.setCustomerFilter("all"); }}>Limpar filtros</Button> : undefined} /> : <div className="cashback-table-wrap" role="region" aria-label="Tabela de clientes" tabIndex={0}><table className="cashback-table"><thead><tr><th scope="col">Cliente</th><th scope="col" className="cashback-amount">Disponível</th><th scope="col" className="cashback-amount">Pendente</th><th scope="col" className="cashback-amount">Reservado</th><th scope="col" className="cashback-amount">Utilizado</th><th scope="col">Próximo vencimento</th><th scope="col">Último uso</th></tr></thead><tbody>{vm.customers.data.items.map(customer => <tr key={customer.buyerId}>
      <td><button type="button" className="cashback-customer-link" onClick={() => vm.selectCustomer(customer)}>{customer.displayName}</button>{customer.email && <small>{customer.email}</small>}</td>
      <td className="cashback-amount">{cashbackMoney(customer.balance.availableCents)}</td><td className="cashback-amount">{cashbackMoney(customer.balance.pendingCents)}</td><td className="cashback-amount">{cashbackMoney(customer.balance.reservedCents)}</td><td className="cashback-amount">{cashbackMoney(customer.balance.usedCents)}</td>
      <td>{customer.balance.nextExpiryAt ? <>{cashbackDate(customer.balance.nextExpiryAt)}<small>{cashbackMoney(customer.balance.nextExpiryCents)}</small></> : "—"}</td><td>{cashbackDate(customer.lastUsedAt)}</td>
    </tr>)}</tbody></table></div>}
  </DataPanel>;
}

export function CashbackPage({merchantId,apiBaseUrl,scopeKey}:{merchantId:string;apiBaseUrl:string;scopeKey:string}) {
  const vm = useCashbackPage(scopeKey);
  const [confirmation, setConfirmation] = useState<"pause" | "end" | null>(null);
  const [assistantOpen,setAssistantOpen] = useState(false);
  const prefix=useId();
  const pageRoot=useRef<HTMLDivElement>(null);
  const actionFeedback=useRef<HTMLParagraphElement>(null);
  useEffect(()=>{setConfirmation(null);setAssistantOpen(false);},[scopeKey]);
  useEffect(()=>{if(vm.actionError&&!confirmation){actionFeedback.current?.focus();actionFeedback.current?.scrollIntoView({block:'nearest'});}},[vm.actionError,confirmation]);
  function switchTab(tab: CashbackTab) { vm.selectCustomer(null); vm.setTab(tab); }
  function changeAssistantOpen(open:boolean,reason:'toggle'|'navigation'='toggle') {
    setAssistantOpen(open);
    if(reason!=='toggle')return;
    requestAnimationFrame(()=>{
      if(open){pageRoot.current?.querySelector<HTMLTextAreaElement>('[aria-label="Mensagem para a IA"]')?.focus();return;}
      const focused=document.activeElement as HTMLElement|null;
      if(!focused||focused===document.body||!focused.getClientRects().length||focused.closest('.chat-dock-collapsed'))pageRoot.current?.querySelector<HTMLButtonElement>('[aria-label="Abrir assistente de cashback"]')?.focus();
    });
  }
  function openManual() { switchTab('settings');requestAnimationFrame(()=>pageRoot.current?.querySelector<HTMLElement>('fieldset:not([hidden]) :is(input,select,textarea)')?.focus()); }
  async function confirm() {
    const result = confirmation === "pause" ? await vm.pause() : await vm.end();
    if (result) setConfirmation(null);
  }
  const programActions = [
    ...(vm.program.data?.status==='active'?[{label:'Pausar novos ganhos',icon:<Pause size={16} aria-hidden="true"/>,disabled:!!vm.busy,onSelect:()=>{vm.clearActionError();setConfirmation('pause');}}]:[]),
    ...(vm.program.data&&vm.program.data.version>0&&vm.program.data.status!=='ended'&&vm.tab==='settings'?[{label:'Encerrar novos ganhos',danger:true,disabled:!!vm.busy,onSelect:()=>{vm.clearActionError();setConfirmation('end');}}]:[]),
  ];
  return <div ref={pageRoot} className="page-container cashback-page" data-tab={vm.tab}>
    <PageHeader title="Cashback" description={vm.tab==='settings'?undefined:'Saldo compartilhado entre site e WhatsApp.'} actions={<><Button className="cashback-header-action" variant="outline" aria-label="Atualizar cashback" onClick={vm.reload} disabled={!!vm.busy || vm.program.loading}><RefreshCw size={16} aria-hidden="true"/><span>Atualizar</span></Button><Button className="cashback-header-action" variant="outline" aria-label="Abrir assistente de cashback" onClick={()=>changeAssistantOpen(true)}><MessageSquare size={16} aria-hidden="true"/><span>Assistente</span></Button></>} />
    {vm.notice && <p role="status" className="cashback-feedback cashback-feedback--success">{vm.notice}</p>}
    {vm.actionError && !confirmation && <p ref={actionFeedback} tabIndex={-1} role="alert" className="cashback-feedback cashback-feedback--error">{vm.actionError}</p>}
    {vm.program.data && <section className="cashback-program-state" aria-label="Situação do programa"><div className="cashback-program-identity"><Wallet size={20} aria-hidden="true"/><div><div className="cashback-program-labels"><span className="cashback-status" data-active={vm.program.data.status === "active"}>{programLabels[vm.program.data.status]}</span><span className="cashback-program-version">{vm.program.data.version>0?`Versão ${vm.program.data.version}`:'Sem publicação'}</span></div><span className="cashback-program-note">Saldos preservados.</span></div></div><div className="cashback-state-actions">
      {vm.tab !== "settings" && <Button className="cashback-program-configure" variant="outline" aria-label="Configurar regras" onClick={() => switchTab("settings")}><Settings2 size={16} aria-hidden="true"/><span>Configurar regras</span></Button>}
      {!!programActions.length&&<RowActionMenu label="Mais ações do cashback" actions={programActions}/>}
    </div></section>}
    <TabBar tabs={[{key:"overview",label:"Visão geral",icon:<LayoutDashboard size={15}/>,panelId:`${prefix}-overview`},{key:"settings",label:"Configuração",icon:<Settings2 size={15}/>,panelId:`${prefix}-settings`},{key:"customers",label:"Clientes",icon:<Users size={15}/>,panelId:`${prefix}-customers`},{key:"transactions",label:"Extrato",icon:<Receipt size={15}/>,panelId:`${prefix}-transactions`}]} activeTab={vm.tab} onTabChange={key => switchTab(key as CashbackTab)} label="Seções de cashback" />
    {!vm.program.data ? vm.program.loading ? <Loading /> : vm.program.error ? <ErrorState message={vm.program.error} retry={vm.reload} /> : null : <>
      {vm.tab === "overview" && <section role="tabpanel" id={`${prefix}-overview`} aria-labelledby={`${prefix}-overview-tab`} className="cashback-overview-content"><Period vm={vm}/>{!vm.validPeriod?<p className="cashback-state">Corrija o período para consultar os resultados.</p>:<CashbackOverview data={vm.metrics.data} program={vm.program.data} loading={vm.metrics.loading} error={vm.metrics.error} onRetry={vm.reload} onConfigure={()=>switchTab('settings')} onStartAssistant={()=>changeAssistantOpen(true)}/>}</section>}
      <section role="tabpanel" id={`${prefix}-settings`} aria-labelledby={`${prefix}-settings-tab`} hidden={vm.tab !== "settings"}><CashbackSettings compact program={vm.program.data} busy={vm.busy} onSave={vm.saveDraft} onPublish={vm.publish} onReview={vm.reviewDraft} reviewedProgram={vm.reviewedProgram} onInvalidateReview={vm.invalidateReview} needsReconciliation={vm.needsReconciliation} onReconcile={vm.retryConfiguration}/></section>
      {vm.tab === "customers" && <section role="tabpanel" id={`${prefix}-customers`} aria-labelledby={`${prefix}-customers-tab`}><Customers vm={vm}/></section>}
      {vm.tab === "transactions" && <section role="tabpanel" id={`${prefix}-transactions`} aria-labelledby={`${prefix}-transactions-tab`}><Transactions vm={vm}/></section>}
    </>}
    <ConfirmDialog open={!!confirmation} title={confirmation === "pause" ? "Pausar novos ganhos de cashback?" : "Encerrar o programa para novos ganhos?"} description={confirmation === "pause" ? "Novos pedidos deixarão de ganhar cashback. Créditos já prometidos ou concedidos, consulta, uso e estornos continuam disponíveis." : "Novos ganhos serão encerrados. Esta ação não apaga saldos nem histórico e mantém o uso dos créditos existentes conforme o regulamento. Comunique a mudança aos clientes."} confirmLabel={confirmation === "pause" ? "Pausar novos ganhos" : "Encerrar novos ganhos"} busy={vm.busy === confirmation} error={vm.actionError} onConfirm={() => void confirm()} onCancel={() => { if (!vm.busy) setConfirmation(null); }} />
    <CashbackAssistant apiBaseUrl={apiBaseUrl} merchantId={merchantId} scopeKey={scopeKey} program={vm.program.data} onDraftUpdated={vm.refreshProgram} onReview={async()=>{vm.selectCustomer(null);return vm.reviewDraft();}} onManual={openManual} expanded={assistantOpen} onExpandedChange={changeAssistantOpen}/>
  </div>;
}
