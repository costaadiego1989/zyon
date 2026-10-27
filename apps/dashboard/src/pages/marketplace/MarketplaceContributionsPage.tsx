import React, { useCallback, useEffect, useRef, useState } from "react";
import { CreditCard } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import type { ContributionCandidate, ContributionCheckoutItem, ContributionCheckoutJournal, ContributionCheckoutStatus,
  marketplaceContributionCheckoutEndpoints } from "../../api/endpoints/marketplace-contribution-checkouts.js";
import { contributionIdentity } from "../../api/endpoints/marketplace-contribution-checkouts.js";
import { useApi } from "../../hooks/useApi.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { PageHeader } from "../../components/PageHeader.js";
import { clearTerminalContributionApproval, contributionSubmissionExists, pendingContributionApproval, rememberContributionApproval,
  rememberContributionSubmission, parseContributionAmount, type ContributionScope, type PendingContribution } from "./contribution-checkout-command-state.js";
import "./marketplace-refunds.css";
import "./marketplace-contributions.css";

type Api = ReturnType<typeof marketplaceContributionCheckoutEndpoints>;
const money = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v / 100);
const labels: Record<ContributionCheckoutStatus, string> = { approved: "Autorizado, aguardando Checkout", creating: "Criação em verificação",
  open: "Checkout disponível", paid: "Pagamento em conciliação", credited: "Aporte conciliado", expired: "Autorização encerrada", unproven: "Resultado em verificação" };
const key = (v: ContributionCheckoutItem) => v.kind === "candidate" ? `r:${v.refund_plan_id}` : `c:${v.contribution_id}`;
function same(old: ContributionCheckoutJournal, current: ContributionCheckoutJournal) {
  if (old.contribution_id !== current.contribution_id || old.refund_plan_id !== current.refund_plan_id || old.environment !== current.environment ||
    old.gross_amount_cents !== current.gross_amount_cents || old.maximum_credit_cents !== current.maximum_credit_cents || old.request_hash !== current.request_hash)
    throw new Error("contribution_binding_changed");
}
export function MarketplaceContributionsPage({ me }: { me: MerchantProfile }) {
  if (me.role !== "OWNER" && me.role !== "ADMIN") return <EmptyState icon={CreditCard} title="Acesso restrito"
    description="Somente proprietários e administradores podem autorizar aportes para estornos." />;
  return <ContributionWorkspace key={`${me.id}:${me.user_id}:${me.role}`} scope={{ merchantId: me.id, userId: me.user_id }} />;
}
function ContributionWorkspace({ scope }: { scope: ContributionScope }) {
  const api = useApi(); return <MarketplaceContributionsWorkspace api={api} scope={scope} />;
}
export function MarketplaceContributionsWorkspace({ api, scope }: { api: Api; scope: ContributionScope }) {
  const [items, setItems] = useState<ContributionCheckoutItem[]>([]), [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [next, setNext] = useState<string | undefined>(), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<ContributionCheckoutItem | null>(null), [amount, setAmount] = useState("");
  const [accepted, setAccepted] = useState(false), [cancelAccepted, setCancelAccepted] = useState(false);
  const [pending, setPending] = useState<PendingContribution | null>(null), [executeSent, setExecuteSent] = useState(false), [excessSent, setExcessSent] = useState(false);
  const [storageBlocked, setStorageBlocked] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const alive = useRef(true), working = useRef(false), revision = useRef(0), heading = useRef<HTMLHeadingElement>(null);
  const returning = useRef(typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("contribution_id"));
  const cursor = cursors[cursors.length - 1];
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++; }; }, []);
  useEffect(() => { if (detail) heading.current?.focus(); }, [detail ? key(detail) : ""]);
  function storage(item: ContributionCheckoutItem) {
    try {
      const store = window.localStorage;
      if (item.kind === "journal") {
        clearTerminalContributionApproval(store, scope, item.refund_plan_id, item.contribution_id, item.status);
        setExecuteSent(contributionSubmissionExists(store, scope, item.contribution_id, "execute"));
        setExcessSent(contributionSubmissionExists(store, scope, item.contribution_id, "excess"));
      } else { setExecuteSent(false); setExcessSent(false); }
      setPending(pendingContributionApproval(store, scope, item.refund_plan_id));
    } catch { setStorageBlocked(true); setExecuteSent(true); setExcessSent(true); }
  }
  function select(item: ContributionCheckoutItem) {
    setDetail(item); storage(item); setAccepted(false); setCancelAccepted(false);
    setAmount(item.kind === "candidate" ? (item.outstanding_net_cents / 100).toFixed(2).replace(".", ",") : "");
  }
  function storageWork<T>(work: (store: Storage) => T): T {
    try { return work(window.localStorage); }
    catch (error) { setStorageBlocked(true); throw error; }
  }
  function replace(value: ContributionCheckoutJournal, old?: ContributionCheckoutJournal) {
    if (old) same(old, value);
    setItems(current => {
      const filtered = current.filter(v => v.kind !== "candidate" || v.refund_plan_id !== value.refund_plan_id);
      return filtered.some(v => key(v) === key(value)) ? filtered.map(v => key(v) === key(value) ? value : v) : [value, ...filtered];
    });
    select(value);
  }
  const load = useCallback(async () => {
    const request = ++revision.current; setLoading(true); setError(""); setDetail(null); setAccepted(false); setCancelAccepted(false); setNext(undefined); setItems([]);
    // Consume only this initial return URL. Changing merchants cannot replay a
    // foreign contribution lookup, and returning never authorizes a POST.
    const returnId = returning.current; returning.current = null;
    if (returnId) { const url = new URL(window.location.href); url.searchParams.delete("contribution_id"); window.history.replaceState(window.history.state, "", url); }
    try {
      const result = await api.listMarketplaceContributionCheckouts(cursor);
      if (!alive.current || request !== revision.current) return;
      if (result.next_cursor && result.next_cursor === cursor) throw new Error("repeated_cursor");
      setItems(result.items); setNext(result.next_cursor);
      if (returnId) {
        if (!contributionIdentity(returnId)) throw new Error("invalid_return_identity");
        const returned = await api.getMarketplaceContributionCheckout(returnId);
        if (!alive.current || request !== revision.current) return;
        replace(returned); setNotice("Consulte o registro abaixo. Use Verificar pagamento para conciliar o resultado no Stripe.");
      }
    } catch { if (alive.current && request === revision.current) setError("Não foi possível carregar os aportes. Atualize a lista ou consulte novamente."); }
    finally { if (alive.current && request === revision.current) setLoading(false); }
  }, [api, cursor, scope.merchantId, scope.userId]);
  useEffect(() => { void load(); }, [load]);

  async function run(work: () => Promise<void>, fallback: string) {
    if (working.current) return; working.current = true; setBusy(true); setError("");
    try { await work(); } catch { if (alive.current) setError(fallback); }
    finally { working.current = false; if (alive.current) { setBusy(false); setAccepted(false); setCancelAccepted(false); } }
  }
  async function review(item: ContributionCheckoutItem) {
    await run(async () => {
      const result = item.kind === "journal" ? await api.getMarketplaceContributionCheckout(item.contribution_id)
        : await api.contextMarketplaceContributionCheckout(item.refund_plan_id);
      if (!alive.current) return;
      if (item.kind === "journal" && result.kind === "journal") same(item, result);
      select(result);
    }, "Não foi possível revisar este aporte. Atualize a lista antes de prosseguir.");
  }
  async function lookupApproval() {
    if (!detail || !pending) return; const old = detail, frozen = pending;
    await run(async () => {
      const result = await api.getMarketplaceContributionCheckout(frozen.id);
      if (!alive.current) return;
      if (result.refund_plan_id !== old.refund_plan_id || result.gross_amount_cents !== frozen.grossCents) throw new Error("approval_changed");
      replace(result); setNotice(labels[result.status]);
    }, "A autorização ainda não foi confirmada. Aguarde e consulte novamente; nenhuma nova autorização será enviada.");
  }
  async function prepare() {
    if (!detail || detail.kind !== "candidate" || !detail.can_create || !accepted || pending || storageBlocked) return;
    const candidate = detail, gross = parseContributionAmount(amount);
    if (gross === null || gross < candidate.outstanding_net_cents) return;
    await run(async () => {
      const old = storageWork(store => pendingContributionApproval(store, scope, candidate.refund_plan_id));
      if (old) { setPending(old); setNotice("Uma autorização já foi solicitada. Consulte o registro antes de prosseguir."); return; }
      const frozen = { id: `mc_${crypto.randomUUID().replaceAll("-", "")}`, grossCents: gross };
      storageWork(store => rememberContributionApproval(store, scope, candidate.refund_plan_id, frozen)); setPending(frozen);
      const result = await api.prepareMarketplaceContributionCheckout(candidate.refund_plan_id, frozen.id, gross);
      if (!alive.current) return; replace(result); setNotice("Autorização registrada. Revise e confirme a criação do Checkout em uma etapa separada.");
    }, "Não foi possível confirmar a autorização. Consulte o registro; uma nova autorização não será enviada automaticamente.");
  }
  async function execute() {
    if (!detail || detail.kind !== "journal" || detail.status !== "approved" || !accepted || executeSent || storageBlocked) return;
    const old = detail;
    await run(async () => {
      if (storageWork(store => contributionSubmissionExists(store, scope, old.contribution_id, "execute"))) { setExecuteSent(true); return; }
      storageWork(store => rememberContributionSubmission(store, scope, old.contribution_id, "execute")); setExecuteSent(true);
      const result = await api.executeMarketplaceContributionCheckout(old.contribution_id, old.gross_amount_cents);
      if (!alive.current) return; replace(result, old); setNotice(labels[result.status]);
    }, "Não foi possível confirmar a criação do Checkout. Consulte o estado ou verifique o pagamento; esta solicitação não será reenviada.");
  }
  async function reconcile() {
    if (!detail || detail.kind !== "journal") return; const old = detail;
    await run(async () => {
      const result = await api.reconcileMarketplaceContributionCheckout(old.contribution_id);
      if (!alive.current) return; replace(result, old); setNotice(labels[result.status]);
    }, "Não foi possível verificar o pagamento. Aguarde e consulte novamente.");
  }
  async function cancel() {
    if (!detail || detail.kind !== "journal" || !detail.can_cancel || !cancelAccepted) return; const old = detail;
    await run(async () => {
      // The server serializes cancel against its first-submission claim. A
      // browser marker must not trap an approval whose POST never arrived.
      // Cancellation never clears that marker or permits creation again.
      const result = await api.cancelMarketplaceContributionCheckout(old.contribution_id);
      if (!alive.current) return; replace(result, old); setNotice("Autorização encerrada sem criar uma cobrança. Atualize a lista para revisar os aportes disponíveis.");
    }, "Não foi possível confirmar o cancelamento. Consulte o estado antes de prosseguir.");
  }
  async function returnExcess() {
    if (!detail || detail.kind !== "journal" || !detail.can_return_excess || !accepted || excessSent || storageBlocked) return; const old = detail;
    await run(async () => {
      if (storageWork(store => contributionSubmissionExists(store, scope, old.contribution_id, "excess"))) { setExcessSent(true); return; }
      storageWork(store => rememberContributionSubmission(store, scope, old.contribution_id, "excess")); setExcessSent(true);
      const result = await api.returnMarketplaceContributionExcess(old.contribution_id, old.excess_liability_cents);
      if (!alive.current) return; replace(result, old); setNotice("Solicitação de devolução do excedente registrada. Verifique o pagamento para acompanhar a conclusão.");
    }, "Não foi possível confirmar a devolução do excedente. Verifique o pagamento; esta solicitação não será reenviada.");
  }
  const candidate = detail?.kind === "candidate" ? detail : null, journal = detail?.kind === "journal" ? detail : null;
  const gross = parseContributionAmount(amount), mayPrepare = candidate?.can_create && !pending && !storageBlocked;
  const mayExecute = journal?.status === "approved" && !executeSent && !storageBlocked;
  const mayExcess = journal?.can_return_excess && !excessSent && !storageBlocked;
  const stateText = (v: ContributionCheckoutItem) => v.kind === "candidate" ? "Aporte necessário" : labels[v.status];
  return <div className="marketplace-refunds marketplace-contributions">
    <PageHeader title="Aportes para estornos" description="Autorize um aporte via cartão no Stripe para completar os fundos de uma devolução integral."
      actions={<Button variant="outline" disabled={loading || busy} onClick={() => void load()}>Atualizar lista</Button>} />
    <p className="marketplace-refunds__help">O valor bruto é escolhido por você. As taxas desta nova cobrança serão conhecidas após a conciliação.</p>
    <div role="status" aria-live="polite" className="marketplace-refunds__notice">{notice}</div>
    {error && <p role="alert" className="marketplace-refunds__error">{error}</p>}
    {loading && <p role="status">Carregando aportes…</p>}
    {!loading && !items.length && !error && <EmptyState icon={CreditCard} title="Nenhum aporte disponível"
      description="As devoluções que precisam de aporte desta loja e os aportes já autorizados aparecem aqui." />}
    {!loading && items.length > 0 && <div className="marketplace-refunds__table-wrap" role="region" aria-label="Aportes para estornos" tabIndex={0}>
      <table className="marketplace-refunds__table"><thead><tr><th>Devolução</th><th>Valor</th><th>Ambiente</th><th>Estado</th><th>Ações</th></tr></thead><tbody>
        {items.map(item => <tr key={key(item)} data-testid={`contribution-${item.kind === "candidate" ? item.refund_plan_id : item.contribution_id}`}>
          <th scope="row"><span className="marketplace-refunds__id">{item.refund_plan_id}</span>{item.kind === "journal" && <small>{item.contribution_id}</small>}</th>
          <td data-label={item.kind === "candidate" ? "Saldo líquido necessário" : "Valor bruto autorizado"} className="marketplace-refunds__money">
            {money(item.kind === "candidate" ? item.outstanding_net_cents : item.gross_amount_cents)}<small>{item.kind === "candidate" ? "Líquido necessário" : "Bruto autorizado"}</small></td>
          <td data-label="Ambiente">{item.environment === "test" ? "Teste" : "Produção"}</td>
          <td data-label="Estado"><span className="marketplace-refunds__state" data-state={item.kind === "journal" ? item.status : "candidate"}>{stateText(item)}</span></td>
          <td><Button variant="outline" disabled={busy} onClick={() => void review(item)}>Revisar aporte</Button></td>
        </tr>)}
      </tbody></table>
    </div>}
    {!loading && (items.length > 0 || next || cursors.length > 1) && <nav className="marketplace-refunds__pagination" aria-label="Páginas de aportes">
      <Button variant="outline" disabled={cursors.length === 1 || busy} onClick={() => setCursors(v => v.slice(0, -1))}>Anterior</Button><span>Página {cursors.length}</span>
      <Button variant="outline" disabled={!next || busy} onClick={() => { if (next) setCursors(v => [...v, next]); }}>Próxima</Button>
    </nav>}
    {detail && <section className="marketplace-refunds__detail" aria-labelledby="contribution-review-title">
      <h2 id="contribution-review-title" ref={heading} tabIndex={-1}>Revisar aporte para estorno</h2>
      <p>Devolução <span className="marketplace-refunds__reference">{detail.refund_plan_id}</span></p>
      <dl className="marketplace-refunds__amounts"><dt>Ambiente</dt><dd>{detail.environment === "test" ? "Teste" : "Produção"}</dd>
        {candidate && <><dt>Líquido ainda necessário</dt><dd><strong>{money(candidate.outstanding_net_cents)}</strong></dd></>}
        {journal && <><dt><strong>Valor bruto autorizado</strong></dt><dd><strong>{money(journal.gross_amount_cents)}</strong></dd>
          <dt>Limite de crédito para esta devolução</dt><dd>{money(journal.maximum_credit_cents)}</dd>
          <dt>Taxa desta cobrança</dt><dd>{journal.processing_fee_known ? money(journal.processing_fee_cents) : "A confirmar"}</dd>
          <dt>Crédito conciliado para o estorno</dt><dd>{journal.processing_fee_known ? money(journal.credited_net_cents) : "A confirmar"}</dd>
          {journal.processing_fee_known && <><dt>Excedente do aporte</dt><dd>{money(journal.excess_liability_cents)}</dd>
            <dt>Excedente devolvido</dt><dd>{money(journal.returned_excess_cents)}</dd></>}</>}
      </dl>
      <p className="marketplace-refunds__help">O pagamento acontece no Checkout hospedado pelo Stripe. O retorno a esta página não confirma pagamento nem estorno ao comprador.</p>
      <p className="marketplace-refunds__help">As taxas são descontadas deste aporte. Um líquido insuficiente pode exigir outro aporte após a conciliação. O excedente fica retido até a confirmação da devolução integral original.</p>
      {storageBlocked && <p role="alert">Este navegador não permite preservar o controle dos envios. Você pode consultar registros e verificar pagamentos.</p>}
      {candidate?.customer_setup_required && <p role="status">Conclua a configuração de cobrança desta loja com Stripe para autorizar um aporte.</p>}
      {candidate && !candidate.can_create && !candidate.customer_setup_required && <p role="status">Este aporte está indisponível enquanto a devolução ou uma autorização anterior aguarda conciliação.</p>}
      {pending && candidate && <p role="status">Uma autorização de {money(pending.grossCents)} já foi solicitada neste navegador. Consulte o registro antes de prosseguir.</p>}
      {mayPrepare && <><label className="marketplace-contributions__amount">Valor bruto do aporte (R$)<input inputMode="decimal" value={amount} disabled={busy}
        autoComplete="off" onChange={event => { setAmount(event.target.value); setAccepted(false); }} aria-describedby="contribution-amount-help" /></label>
        <p id="contribution-amount-help" className="marketplace-refunds__help">Informe pelo menos {money(candidate!.outstanding_net_cents)}. A taxa do cartão ainda não é conhecida; este valor não garante o líquido necessário.</p>
        <label className="marketplace-refunds__accept"><input type="checkbox" checked={accepted} disabled={busy || gross === null || gross < candidate!.outstanding_net_cents} onChange={event => setAccepted(event.target.checked)} />
          Autorizo o valor bruto {gross === null ? "informado acima" : money(gross)} para esta devolução e aceito as taxas da cobrança.</label></>}
      {journal && <p role="status">{executeSent && journal.status === "approved" ? "Criação sem confirmação. A solicitação não será repetida." : labels[journal.status]}</p>}
      {mayExecute && <label className="marketplace-refunds__accept"><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} />
        Confirmo criar agora um Checkout de {money(journal!.gross_amount_cents)} para pagar com cartão.</label>}
      {journal?.can_cancel && <label className="marketplace-refunds__accept"><input type="checkbox" checked={cancelAccepted} disabled={busy} onChange={event => setCancelAccepted(event.target.checked)} />
        Quero encerrar esta autorização antes de criar o Checkout.</label>}
      {journal?.checkout_url && <a className="marketplace-contributions__checkout" href={journal.checkout_url} target="_blank" rel="noopener noreferrer">Abrir Checkout do Stripe em nova aba</a>}
      {journal?.excess_status && <p role="status">{journal.excess_status === "returned" ? "Devolução do excedente confirmada." : journal.excess_status === "held" ? "Excedente retido para conciliação." : "Devolução do excedente em verificação."}</p>}
      {mayExcess && <label className="marketplace-refunds__accept"><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} />
        Autorizo devolver {money(journal!.excess_liability_cents)} ao cartão usado neste aporte.</label>}
      {excessSent && journal?.excess_status === "held" && <p className="marketplace-refunds__help">Uma devolução do excedente já foi solicitada neste navegador. Verifique o pagamento; ela não será repetida.</p>}
      <div className="marketplace-refunds__actions"><Button variant="outline" disabled={busy} onClick={() => { setDetail(null); setAccepted(false); setCancelAccepted(false); }}>Fechar detalhes</Button>
        <Button variant="outline" disabled={busy} onClick={() => void review(detail)}>Consultar estado</Button>
        {candidate && pending && <Button variant="outline" disabled={busy} onClick={() => void lookupApproval()}>Consultar autorização</Button>}
        {mayPrepare && <Button disabled={!accepted || busy || gross === null || gross < candidate!.outstanding_net_cents} loading={busy} onClick={() => void prepare()}>Registrar autorização do aporte</Button>}
        {mayExecute && <Button disabled={!accepted || busy} loading={busy} onClick={() => void execute()}>Criar Checkout autorizado</Button>}
        {journal?.can_cancel && <Button variant="outline" disabled={!cancelAccepted || busy} onClick={() => void cancel()}>Cancelar autorização</Button>}
        {journal && <Button variant="outline" disabled={busy} onClick={() => void reconcile()}>Verificar pagamento</Button>}
        {mayExcess && <Button variant="danger" disabled={!accepted || busy} onClick={() => void returnExcess()}>Devolver excedente autorizado</Button>}
      </div>
    </section>}
  </div>;
}
