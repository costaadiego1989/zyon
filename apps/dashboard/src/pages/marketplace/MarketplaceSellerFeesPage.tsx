import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CreditCard } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { assertSameSellerFeeJournal, sellerFeeIdentity, type SellerFeeCandidate, type SellerFeeJournal, type SellerFeeStatus,
  type marketplaceSellerFeeCollectionEndpoints, type MarketplaceFeeCollectionFamily } from "../../api/endpoints/marketplace-seller-fee-collections.js";
import { useApi } from "../../hooks/useApi.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { PageHeader } from "../../components/PageHeader.js";
import { clearTerminalSellerFeeApproval, pendingSellerFeeApproval, rememberSellerFeeApproval, rememberSellerFeeSubmission,
  sellerFeeSubmissionExists, parseSellerFeeAmount, type PendingSellerFee, type SellerFeeScope } from "./seller-fee-command-state.js";
import "./marketplace-seller-fees.css";

type Api = ReturnType<typeof marketplaceSellerFeeCollectionEndpoints>;
const money = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v / 100);
const labels: Record<SellerFeeStatus, string> = {
  approved: "Autorização registrada", creating: "Criação em verificação", open: "Checkout disponível", paid: "Pagamento em conciliação",
  credited: "Crédito líquido conciliado", expired: "Autorização encerrada", unproven: "Resultado em verificação",
};
const obligationLabel = (v: SellerFeeCandidate) => v.obligation_status === "closed" ? "Obrigação individual quitada"
  : v.obligation_status === "fees_collected_excess_held" ? "Taxas cobertas, excedente retido" : v.outstanding_cents > 0 ? "Taxas pendentes" : "Pronta para quitação individual";
function assertContext(j: SellerFeeJournal, c: SellerFeeCandidate): void {
  if (j.debt_id !== c.debt_id || j.fee_certificate_id !== c.fee_certificate_id || j.environment !== c.environment)
    throw new Error("seller_fee_context_changed");
}
function assertApproval(j: SellerFeeJournal, p: PendingSellerFee): void {
  if (j.collection_id !== p.id || j.gross_amount_cents !== p.grossCents || j.fee_certificate_id !== p.feeCertificateId || j.environment !== p.environment)
    throw new Error("seller_fee_approval_changed");
}
export function MarketplaceSellerFeesPage({ me, family = "seller" }: { me: MerchantProfile; family?: MarketplaceFeeCollectionFamily }) {
  if (me.role !== "OWNER" && me.role !== "ADMIN") return <EmptyState icon={CreditCard} title="Acesso restrito"
    description="Somente proprietários e administradores podem autorizar pagamentos de taxas do marketplace." />;
  return <SellerFeeWorkspace key={`${me.id}:${me.user_id}:${me.role}:${family}`} scope={{ merchantId: me.id, userId: me.user_id, family }} />;
}
function SellerFeeWorkspace({ scope }: { scope: SellerFeeScope }) {
  const api = useApi();
  const scopedApi = useMemo<Api>(() => scope.family !== "host" ? api : ({
    candidatesMarketplaceSellerFeeCollections: api.candidatesMarketplaceHostFeeCollections,
    contextMarketplaceSellerFeeCollection: api.contextMarketplaceHostFeeCollection,
    listMarketplaceSellerFeeCollections: api.listMarketplaceHostFeeCollections,
    getMarketplaceSellerFeeCollection: api.getMarketplaceHostFeeCollection,
    prepareMarketplaceSellerFeeCollection: api.prepareMarketplaceHostFeeCollection,
    executeMarketplaceSellerFeeCollection: api.executeMarketplaceHostFeeCollection,
    reconcileMarketplaceSellerFeeCollection: api.reconcileMarketplaceHostFeeCollection,
    returnMarketplaceSellerFeeExcess: api.returnMarketplaceHostFeeExcess,
    cancelMarketplaceSellerFeeCollection: api.cancelMarketplaceHostFeeCollection,
    closeMarketplaceSellerFeeObligation: api.closeMarketplaceHostFeeObligation,
  }), [api, scope.family]);
  return <MarketplaceSellerFeesWorkspace api={scopedApi} scope={scope} />;
}
export function MarketplaceSellerFeesWorkspace({ api, scope }: { api: Api; scope: SellerFeeScope }) {
  const family = scope.family ?? "seller", minimum = 50;
  const feeId = (suffix: string) => `${family}-fee-${suffix}`;
  const returnQuery = family === "host" ? "host_fee_collection_id" : "collection_id";
  const parseAmount = (value: string) => { const cents = parseSellerFeeAmount(value); return cents !== null && cents >= minimum ? cents : null; };
  const [items, setItems] = useState<SellerFeeCandidate[]>([]), [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [next, setNext] = useState<string>(), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [context, setContext] = useState<SellerFeeCandidate | null>(null), [journal, setJournal] = useState<SellerFeeJournal | null>(null);
  const [history, setHistory] = useState<SellerFeeJournal[]>([]), [historyCursors, setHistoryCursors] = useState<Array<string | undefined>>([undefined]);
  const [historyNext, setHistoryNext] = useState<string>(), [amount, setAmount] = useState("");
  const [accepted, setAccepted] = useState(false), [cancelAccepted, setCancelAccepted] = useState(false), [closeAccepted, setCloseAccepted] = useState(false);
  const [excessAccepted, setExcessAccepted] = useState(false), [excessSent, setExcessSent] = useState(false);
  const [pending, setPending] = useState<PendingSellerFee | null>(null), [executeSent, setExecuteSent] = useState(false), [storageBlocked, setStorageBlocked] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const alive = useRef(true), working = useRef(false), reading = useRef(true), revision = useRef(0), heading = useRef<HTMLHeadingElement>(null);
  const returnId = useRef(typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get(returnQuery));
  const cursor = cursors[cursors.length - 1];
  const current = (token: number) => alive.current && token === revision.current;
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++; }; }, []);
  useEffect(() => { if (context) heading.current?.focus(); }, [context?.debt_id]);
  function storageWork<T>(work: (store: Storage) => T): T {
    try { return work(window.localStorage); } catch (err) { if (alive.current) setStorageBlocked(true); throw err; }
  }
  function restore(c: SellerFeeCandidate, j?: SellerFeeJournal): PendingSellerFee | null {
    try {
      const p = storageWork(store => {
        if (j) clearTerminalSellerFeeApproval(store, scope, c.debt_id, j);
        return pendingSellerFeeApproval(store, scope, c.debt_id);
      });
      if (p && (p.feeCertificateId !== c.fee_certificate_id || p.environment !== c.environment)) throw new Error("seller_fee_pending_context_changed");
      setPending(p); setExecuteSent(j ? storageWork(store => sellerFeeSubmissionExists(store, scope, j.collection_id)) : false);
      setExcessSent(j ? storageWork(store => sellerFeeSubmissionExists(store, scope, j.collection_id, "excess")) : false); return p;
    } catch { setStorageBlocked(true); setExecuteSent(true); setExcessSent(true); return null; }
  }
  function resetConsent() { setAccepted(false); setCancelAccepted(false); setCloseAccepted(false); setExcessAccepted(false); }
  function show(c: SellerFeeCandidate, records: SellerFeeJournal[], j?: SellerFeeJournal) {
    records.forEach(v => assertContext(v, c)); if (j) assertContext(j, c);
    setContext(c); setJournal(j ?? null); setHistory(records); setAmount((Math.max(c.outstanding_cents, minimum) / 100).toFixed(2).replace(".", ","));
    resetConsent(); return restore(c, j);
  }
  async function openDebt(debtId: string, token: number, selected?: SellerFeeJournal) {
    const [c, records] = await Promise.all([api.contextMarketplaceSellerFeeCollection(debtId), api.listMarketplaceSellerFeeCollections(debtId)]);
    if (!current(token)) return;
    const p = show(c, records.items, selected); setHistoryCursors([undefined]); setHistoryNext(records.next_cursor);
    if (p && !selected) {
      // Restoring a lost approval performs only an exact-ID GET. Even 404 is
      // unknown here, and never permits generating another authorization.
      try {
        const recovered = await api.getMarketplaceSellerFeeCollection(p.id);
        if (!current(token)) return; assertApproval(recovered, p); assertContext(recovered, c);
        setJournal(recovered); restore(c, recovered); setNotice(labels[recovered.status]);
      } catch { if (current(token)) setNotice("Uma autorização anterior aguarda confirmação. Consulte a autorização; nenhum novo envio será feito."); }
    }
  }
  const load = useCallback(async () => {
    if (working.current) return;
    const token = ++revision.current; reading.current = true; setLoading(true); setError(""); setItems([]); setNext(undefined); setContext(null); setJournal(null); resetConsent();
    const returning = returnId.current;
    if (returning) {
      const url = new URL(window.location.href); url.searchParams.delete(returnQuery);
      window.history.replaceState(window.history.state, "", url);
    }
    try {
      const results = await Promise.allSettled([api.candidatesMarketplaceSellerFeeCollections(cursor),
        returning && sellerFeeIdentity(returning) ? api.getMarketplaceSellerFeeCollection(returning) : Promise.resolve(null)]);
      if (!current(token)) return;
      if (results[0].status === "fulfilled") {
        const result = results[0].value; if (result.next_cursor && cursors.includes(result.next_cursor)) throw new Error("repeated_cursor");
        setItems(result.items); setNext(result.next_cursor);
      } else setError("Não foi possível carregar as taxas. Atualize a lista para tentar novamente.");
      if (returning) {
        if (!sellerFeeIdentity(returning) || results[1].status !== "fulfilled" || !results[1].value) throw new Error("invalid_return_identity");
        const returned = results[1].value; await openDebt(returned.debt_id, token, returned);
        if (current(token)) setNotice("Retorno do Checkout recebido. Consulte o registro ou use Verificar pagamento para conciliar o resultado.");
      }
    } catch { if (current(token)) setError("Não foi possível confirmar os registros. Consulte novamente; o retorno do Checkout não comprova pagamento."); }
    finally { if (current(token)) { returnId.current = null; reading.current = false; setLoading(false); } }
  }, [api, cursor, scope.merchantId, scope.userId, family]);
  useEffect(() => { void load(); }, [load]);
  async function run(work: (token: number) => Promise<void>, fallback: string) {
    if (working.current || reading.current) return;
    working.current = true; setBusy(true); setError(""); const token = revision.current;
    try { await work(token); } catch { if (current(token)) setError(fallback); }
    finally { working.current = false; if (current(token)) { setBusy(false); resetConsent(); } }
  }
  async function review(c: SellerFeeCandidate) {
    await run(token => openDebt(c.debt_id, token), "Não foi possível revisar esta obrigação. Atualize a lista antes de prosseguir.");
  }
  async function refreshJournal(value: SellerFeeJournal, token: number, before?: SellerFeeJournal) {
    if (!current(token) || !context) return;
    if (before) assertSameSellerFeeJournal(before, value); assertContext(value, context);
    setJournal(value); restore(context, value); setHistory(v => v.some(x => x.collection_id === value.collection_id)
      ? v.map(x => x.collection_id === value.collection_id ? value : x) : [value, ...v]);
    // The receipt is shown before refreshing context. A failed GET does not
    // discard it or turn its command into permission for another POST.
    const updated = await api.contextMarketplaceSellerFeeCollection(value.debt_id);
    if (!current(token)) return; assertContext(value, updated); setContext(updated);
    setItems(v => v.map(x => x.debt_id === updated.debt_id ? updated : x)); restore(updated, value);
  }
  async function consult() {
    if (!context) return;
    const c = context, old = journal;
    await run(async token => {
      if (old) {
        const result = await api.getMarketplaceSellerFeeCollection(old.collection_id); if (!current(token)) return;
        await refreshJournal(result, token, old); if (current(token)) setNotice(labels[result.status]);
      } else await openDebt(c.debt_id, token);
    }, "Não foi possível consultar o estado. Aguarde e consulte novamente.");
  }
  async function consultApproval() {
    if (!context || !pending) return;
    const c = context, p = pending;
    await run(async token => {
      const result = await api.getMarketplaceSellerFeeCollection(p.id); if (!current(token)) return;
      assertApproval(result, p); assertContext(result, c); await refreshJournal(result, token); if (current(token)) setNotice(labels[result.status]);
    }, "A autorização ainda não foi confirmada. Aguarde e consulte novamente; uma nova autorização não será enviada.");
  }
  async function prepare() {
    if (!context?.can_prepare || pending || storageBlocked || !accepted) return;
    const c = context, gross = parseAmount(amount); if (gross === null) return;
    await run(async token => {
      const prior = storageWork(store => pendingSellerFeeApproval(store, scope, c.debt_id));
      if (prior) { setPending(prior); setNotice("Uma autorização já foi solicitada. Consulte o registro antes de prosseguir."); return; }
      const frozen: PendingSellerFee = { id: `${family === "host" ? "mhostfee" : "mcfee"}_${crypto.randomUUID().replaceAll("-", "")}`, grossCents: gross,
        feeCertificateId: c.fee_certificate_id, environment: c.environment };
      storageWork(store => rememberSellerFeeApproval(store, scope, c.debt_id, frozen)); setPending(frozen);
      const result = await api.prepareMarketplaceSellerFeeCollection(c.debt_id, frozen.id, gross);
      if (!current(token)) return; assertApproval(result, frozen); await refreshJournal(result, token);
      if (current(token)) setNotice("Autorização registrada. Revise o valor e confirme a criação do Checkout na etapa seguinte.");
    }, "Não foi possível confirmar a autorização. Consulte a autorização registrada; nenhum novo envio será feito automaticamente.");
  }
  async function execute() {
    if (!journal?.can_execute || journal.gross_amount_cents < minimum || !accepted || executeSent || storageBlocked) return; const old = journal;
    await run(async token => {
      if (storageWork(store => sellerFeeSubmissionExists(store, scope, old.collection_id))) { setExecuteSent(true); return; }
      storageWork(store => rememberSellerFeeSubmission(store, scope, old.collection_id)); setExecuteSent(true);
      const result = await api.executeMarketplaceSellerFeeCollection(old.collection_id, old.gross_amount_cents);
      if (!current(token)) return; await refreshJournal(result, token, old); if (current(token)) setNotice(labels[result.status]);
    }, "Não foi possível confirmar a criação do Checkout. Consulte o estado ou verifique o pagamento; esta solicitação não será reenviada.");
  }
  async function reconcile() {
    if (!journal) return; const old = journal;
    await run(async token => {
      const result = await api.reconcileMarketplaceSellerFeeCollection(old.collection_id);
      if (!current(token)) return; await refreshJournal(result, token, old); if (current(token)) setNotice(labels[result.status]);
    }, "Não foi possível verificar o pagamento. Aguarde e consulte novamente.");
  }
  async function cancel() {
    if (!journal?.can_cancel || !cancelAccepted) return; const old = journal;
    await run(async token => {
      const result = await api.cancelMarketplaceSellerFeeCollection(old.collection_id);
      if (!current(token)) return; await refreshJournal(result, token, old);
      if (current(token)) setNotice("Autorização encerrada antes de criar o Checkout. Consulte o saldo e o histórico antes de prosseguir.");
    }, "Não foi possível confirmar o cancelamento. Consulte o estado antes de prosseguir.");
  }
  async function returnExcess() {
    if (!journal?.can_return_excess || !excessAccepted || excessSent || storageBlocked || journal.excess_status !== "held" ||
      journal.outstanding_excess_cents !== journal.excess_liability_cents || journal.excess_liability_cents < 1) return;
    const old = journal;
    await run(async token => {
      if (storageWork(store => sellerFeeSubmissionExists(store, scope, old.collection_id, "excess"))) { setExcessSent(true); return; }
      storageWork(store => rememberSellerFeeSubmission(store, scope, old.collection_id, "excess")); setExcessSent(true);
      const result = await api.returnMarketplaceSellerFeeExcess(old.collection_id, old.excess_liability_cents);
      if (!current(token)) return;
      if (result.excess_liability_cents !== old.excess_liability_cents) throw new Error("seller_fee_excess_changed");
      await refreshJournal(result, token, old);
      if (current(token)) setNotice(result.excess_status === "returned" ? "Devolução do excedente confirmada." : "Devolução do excedente em verificação.");
    }, "Não foi possível confirmar a devolução do excedente. Consulte o estado ou verifique o pagamento; esta solicitação não será reenviada.");
  }
  async function closeObligation() {
    if (!context?.obligation_can_close || !closeAccepted) return; const c = context;
    await run(async token => {
      const receipt = await api.closeMarketplaceSellerFeeObligation(c.debt_id); if (!current(token)) return;
      const updated = await api.contextMarketplaceSellerFeeCollection(c.debt_id); if (!current(token)) return;
      if (updated.obligation_status !== "closed" || updated.obligation_id !== receipt.obligationId || updated.fee_certificate_id !== c.fee_certificate_id || updated.environment !== c.environment)
        throw new Error("seller_fee_obligation_context_changed");
      setContext(updated); setItems(v => v.map(x => x.debt_id === updated.debt_id ? updated : x));
      setNotice("Obrigação individual quitada. A conciliação financeira do pedido continua separada.");
    }, "Não foi possível confirmar a quitação individual. Consulte o estado antes de prosseguir.");
  }
  async function historyPage(cursorValue: string | undefined, stack: Array<string | undefined>) {
    if (!context) return; const c = context;
    await run(async token => {
      const result = await api.listMarketplaceSellerFeeCollections(c.debt_id, cursorValue); if (!current(token)) return;
      result.items.forEach(v => assertContext(v, c)); if (result.next_cursor && stack.includes(result.next_cursor)) throw new Error("repeated_cursor");
      setHistory(result.items); setHistoryCursors(stack); setHistoryNext(result.next_cursor);
    }, "Não foi possível carregar esta página do histórico. Tente consultar novamente.");
  }
  async function reviewJournal(record: SellerFeeJournal) {
    await run(async token => {
      const updated = await api.getMarketplaceSellerFeeCollection(record.collection_id); if (!current(token)) return;
      assertSameSellerFeeJournal(record, updated); if (!context) return; assertContext(updated, context);
      setJournal(updated); restore(context, updated); resetConsent(); setNotice(labels[updated.status]);
    }, "Não foi possível revisar esta cobrança. Consulte o estado antes de prosseguir.");
  }
  const gross = parseAmount(amount), mayPrepare = context?.can_prepare && !pending && !storageBlocked && (!journal || ["credited", "expired"].includes(journal.status));
  const mayExecute = journal?.can_execute && journal.gross_amount_cents >= minimum && !executeSent && !storageBlocked;
  const mayReturnExcess = journal?.can_return_excess && !excessSent && !storageBlocked;
  const preparationBlocked = context ? !context.can_prepare : items.length > 0 && items.every(c => !c.can_prepare);
  const recoveryOnly = preparationBlocked && journal?.can_execute !== true;
  return <div className="marketplace-seller-fees" data-testid={`${family}-fees-page`}>
    <PageHeader title={family === "host" ? "Taxas da loja principal" : "Taxas do marketplace"}
      description={recoveryOnly ? "Consulte cobranças anteriores e acompanhe sua conciliação."
        : family === "host" ? "Revise as taxas atribuídas às vendas próprias desta loja e autorize o pagamento com cartão no Stripe."
        : "Revise as taxas atribuídas a esta loja e autorize o pagamento com cartão no Stripe."}
      actions={<Button variant="outline" disabled={loading || busy} onClick={() => void load()}>Atualizar lista</Button>} />
    <p className="marketplace-seller-fees__help">{recoveryOnly ? "Modo de recuperação: novas cobranças estão indisponíveis. Os registros históricos continuam disponíveis para consulta e conciliação."
      : family === "host" ? "Esta loja principal assume a parcela das taxas de disputa proporcional às suas próprias vendas e o processamento do novo pagamento."
      : "As taxas originais são proporcionais às vendas de cada vendedor. Esta loja também assume o processamento do novo pagamento."}</p>
    <p role="status" aria-live="polite" className="marketplace-seller-fees__notice">{notice}</p>
    {error && <p role="alert" className="marketplace-seller-fees__error">{error}</p>}
    {loading && <div className="marketplace-seller-fees__loading" role="status" aria-label="Carregando taxas do marketplace"><span /> <span /> <span /><p>Carregando registros…</p></div>}
    {!loading && !items.length && !error && <EmptyState icon={CreditCard} title="Nenhuma taxa disponível"
      description="As taxas de disputas que podem ser consultadas por esta loja aparecem aqui, junto com o saldo e a situação de quitação." />}
    {!loading && !!items.length && <div className="marketplace-seller-fees__table-wrap" role="region" aria-label="Obrigações da loja" tabIndex={0}>
      <table className="marketplace-seller-fees__table"><thead><tr><th scope="col">Obrigação</th><th scope="col">Saldo de taxas</th><th scope="col">Ambiente</th><th scope="col">Situação</th><th scope="col">Ações</th></tr></thead>
        <tbody>{items.map(c => <tr key={c.debt_id} data-testid={`${family}-fee-candidate-${c.debt_id}`}>
          <th scope="row"><span className="marketplace-seller-fees__reference">{c.debt_id}</span></th>
          <td data-label="Saldo de taxas" className="marketplace-seller-fees__money">{money(c.outstanding_cents)}</td>
          <td data-label="Ambiente">{c.environment === "test" ? "Teste" : "Produção"}</td>
          <td data-label="Situação"><span className="marketplace-seller-fees__state" data-state={c.obligation_status}>{obligationLabel(c)}</span></td>
          <td><Button variant="outline" disabled={busy} onClick={() => void review(c)}>Revisar taxas</Button></td>
        </tr>)}</tbody></table>
    </div>}
    {!loading && (!!items.length || next || cursors.length > 1) && <nav className="marketplace-seller-fees__pagination" aria-label="Páginas de obrigações">
      <Button variant="outline" data-testid={feeId("candidates-previous")} disabled={cursors.length === 1 || busy} onClick={() => setCursors(v => v.slice(0, -1))}>Anterior</Button>
      <span>Página {cursors.length}</span><Button variant="outline" data-testid={feeId("candidates-next")} disabled={!next || busy} onClick={() => { if (next) setCursors(v => [...v, next]); }}>Próxima</Button>
    </nav>}
    {context && <section className="marketplace-seller-fees__detail" aria-labelledby={feeId("review-title")} data-testid={feeId("detail")}>
      <h2 id={feeId("review-title")} ref={heading} tabIndex={-1}>{family === "host" ? "Revisar taxas da loja principal" : "Revisar taxas da loja"}</h2>
      <p>Obrigação <span className="marketplace-seller-fees__reference">{context.debt_id}</span></p>
      <dl className="marketplace-seller-fees__amounts"><dt>Ambiente</dt><dd>{context.environment === "test" ? "Teste" : "Produção"}</dd>
        <dt>Taxas originais desta loja</dt><dd>{money(context.due_cents)}</dd><dt>Líquido conciliado para as taxas</dt><dd>{money(context.collected_cents)}</dd>
        <dt><strong>Saldo de taxas pendente</strong></dt><dd><strong>{money(context.outstanding_cents)}</strong></dd>
        <dt>Processamento dos novos pagamentos</dt><dd>{money(context.processing_fee_cents)}</dd>
        <dt>Excedente retido</dt><dd>{money(context.excess_liability_cents)}</dd><dt>Situação da obrigação</dt><dd>{obligationLabel(context)}</dd>
      </dl>
      {context.due_cents === 0 ? <p className="marketplace-seller-fees__help">A parcela de taxa atribuída a esta loja é zero. Após a comprovação do principal, você pode encerrar esta obrigação sem pagamento.</p>
        : !recoveryOnly && <><p className="marketplace-seller-fees__help">O pagamento acontece no Checkout do Stripe. A taxa de processamento será conhecida após a conciliação e descontada do valor bruto autorizado.</p>
          <p className="marketplace-seller-fees__help">Um pagamento parcial pode exigir nova autorização após a conciliação. Se houver excedente, ele permanece retido até a devolução comprovada.</p></>}
      <p className="marketplace-seller-fees__help">A quitação individual não libera o saldo do pedido nem autoriza repasses.</p>
      {storageBlocked && <p role="alert">Este navegador não permite preservar o controle dos envios. Você pode consultar registros, verificar pagamentos e cancelar uma autorização ainda não enviada.</p>}
      {context.customer_setup_required && !recoveryOnly && <p role="status">Conclua a configuração de cobrança desta loja com Stripe para autorizar o pagamento.</p>}
      {!recoveryOnly && !context.can_prepare && !context.customer_setup_required && context.outstanding_cents > 0 && <p className="marketplace-seller-fees__help">Há uma cobrança ou conciliação pendente. Consulte o histórico antes de autorizar outro pagamento.</p>}
      {pending && (!journal || journal.collection_id !== pending.id) && <p role="status">Uma autorização de {money(pending.grossCents)} já foi solicitada neste navegador. Consulte a autorização antes de prosseguir.</p>}
      {mayPrepare && <><label className="marketplace-seller-fees__amount" htmlFor={feeId("amount")}>Valor bruto autorizado (R$)
        <input id={feeId("amount")} data-testid={feeId("amount")} inputMode="decimal" min="0.50" autoComplete="off" value={amount} disabled={busy}
          onChange={event => { setAmount(event.target.value); setAccepted(false); }} aria-describedby={feeId("amount-help")} aria-invalid={gross === null} /></label>
        <p id={feeId("amount-help")} className="marketplace-seller-fees__help">O valor mínimo para este pagamento é R$ 0,50, com até duas casas decimais. O saldo líquido necessário é {money(context.outstanding_cents)}; o valor bruto não garante esse líquido após as taxas.</p>
        {gross === null && <p role="status">Informe um valor de pelo menos R$ 0,50, com até duas casas decimais.</p>}
        <label className="marketplace-seller-fees__accept"><input type="checkbox" data-testid={feeId("consent")} checked={accepted} disabled={busy || gross === null} onChange={e => setAccepted(e.target.checked)} />
          Autorizo {gross === null ? "o valor informado" : money(gross)} para {family === "host" ? "as taxas das vendas próprias desta loja principal" : "as taxas desta loja"} e aceito o processamento deste pagamento.</label>
        <Button data-testid={feeId("prepare")} disabled={!accepted || busy || gross === null} loading={busy} onClick={() => void prepare()}>Registrar autorização</Button></>}
      {journal && <div className="marketplace-seller-fees__receipt" aria-labelledby={feeId("receipt-title")}>
        <h3 id={feeId("receipt-title")}>Cobrança selecionada</h3><p className="marketplace-seller-fees__reference">{journal.collection_id}</p>
        <p role="status">{executeSent && journal.status === "approved" ? "Criação sem confirmação. A solicitação não será repetida." : labels[journal.status]}</p>
        {journal.status === "approved" && journal.gross_amount_cents < minimum && <p role="status">Esta autorização está abaixo do mínimo de R$ 0,50 para criar o Checkout. {recoveryOnly
          ? "Ela continua disponível para consulta e cancelamento." : "Cancele-a e registre uma nova autorização de pelo menos R$ 0,50."}</p>}
        <dl className="marketplace-seller-fees__amounts"><dt><strong>Valor bruto autorizado</strong></dt><dd><strong>{money(journal.gross_amount_cents)}</strong></dd>
          <dt>Limite de crédito para as taxas</dt><dd>{money(journal.maximum_credit_cents)}</dd>
          <dt>Processamento desta cobrança</dt><dd>{journal.processing_fee_known ? money(journal.processing_fee_cents) : "A confirmar"}</dd>
          <dt>Líquido conciliado desta cobrança</dt><dd>{journal.processing_fee_known ? money(journal.credited_net_cents) : "A confirmar"}</dd>
          <dt>Excedente original desta cobrança</dt><dd>{journal.processing_fee_known ? money(journal.excess_liability_cents) : "A confirmar"}</dd>
          {journal.processing_fee_known && journal.excess_liability_cents > 0 && <><dt>Excedente devolvido</dt><dd>{money(journal.returned_excess_cents ?? 0)}</dd>
            <dt>Excedente ainda devido</dt><dd>{money(journal.outstanding_excess_cents ?? journal.excess_liability_cents)}</dd></>}
        </dl>
        {mayExecute && <label className="marketplace-seller-fees__accept"><input type="checkbox" data-testid={feeId("execute-consent")} checked={accepted} disabled={busy} onChange={e => setAccepted(e.target.checked)} />
          Confirmo criar agora um Checkout de {money(journal.gross_amount_cents)} para pagar com cartão.</label>}
        {journal.can_cancel && <label className="marketplace-seller-fees__accept"><input type="checkbox" data-testid={feeId("cancel-consent")} checked={cancelAccepted} disabled={busy} onChange={e => setCancelAccepted(e.target.checked)} />
          Quero encerrar esta autorização antes de criar o Checkout.</label>}
        {journal.checkout_url && <a className="marketplace-seller-fees__checkout" data-testid={feeId("checkout")} href={journal.checkout_url} target="_blank" rel="noopener noreferrer">Abrir Checkout do Stripe em nova aba</a>}
        {journal.excess_status && <p role="status">{journal.excess_status === "returned" ? "Devolução do excedente confirmada." : journal.excess_status === "held"
          ? "Excedente retido para tratamento financeiro. A obrigação individual ainda não pode ser quitada." : journal.excess_status === "failed"
            ? "A devolução do excedente não foi concluída. Verifique o pagamento para acompanhar o resultado." : "Devolução do excedente em verificação."}</p>}
        {mayReturnExcess && <label className="marketplace-seller-fees__accept"><input type="checkbox" data-testid={feeId("excess-consent")} checked={excessAccepted} disabled={busy} onChange={e => setExcessAccepted(e.target.checked)} />
          Autorizo devolver {money(journal.excess_liability_cents)} ao cartão usado nesta cobrança.</label>}
        {excessSent && journal.excess_status === "held" && <p role="status">Uma devolução do excedente já foi solicitada neste navegador. Consulte o estado ou verifique o pagamento; ela não será repetida.</p>}
        <div className="marketplace-seller-fees__actions">
          {mayExecute && <Button data-testid={feeId("execute")} disabled={!accepted || busy} loading={busy} onClick={() => void execute()}>Criar Checkout autorizado</Button>}
          {journal.can_cancel && <Button variant="outline" data-testid={feeId("cancel")} disabled={!cancelAccepted || busy} onClick={() => void cancel()}>Cancelar autorização</Button>}
          <Button variant="outline" data-testid={feeId("reconcile")} disabled={busy} onClick={() => void reconcile()}>Verificar pagamento</Button>
          {mayReturnExcess && <Button variant="danger" data-testid={feeId("excess-return")} disabled={!excessAccepted || busy} onClick={() => void returnExcess()}>Devolver excedente autorizado</Button>}
        </div>
      </div>}
      {context.obligation_can_close && <label className="marketplace-seller-fees__accept"><input type="checkbox" data-testid={feeId("obligation-close-consent")} checked={closeAccepted} disabled={busy} onChange={e => setCloseAccepted(e.target.checked)} />
        {context.due_cents === 0 ? "Confirmo encerrar a obrigação desta loja com principal comprovado e parcela de taxa zero, sem pagamento."
          : "Confirmo quitar a obrigação individual desta loja com os créditos já conciliados."}</label>}
      <div className="marketplace-seller-fees__actions">
        <Button variant="outline" disabled={busy} onClick={() => { setContext(null); setJournal(null); resetConsent(); }}>Fechar detalhes</Button>
        <Button variant="outline" data-testid={feeId("consult-state")} disabled={busy} onClick={() => void consult()}>Consultar estado</Button>
        {pending && <Button variant="outline" data-testid={feeId("consult-approval")} disabled={busy} onClick={() => void consultApproval()}>Consultar autorização</Button>}
        {context.obligation_status !== "closed" && <Button data-testid={feeId("obligation-close")} disabled={!context.obligation_can_close || !closeAccepted || busy} onClick={() => void closeObligation()}>Quitar obrigação individual</Button>}
      </div>
      <h3>Histórico de cobranças</h3>
      {!history.length ? <p className="marketplace-seller-fees__help">Nenhuma cobrança registrada para esta obrigação.</p> : <ul className="marketplace-seller-fees__history">
        {history.map(j => <li key={j.collection_id} data-testid={`${family}-fee-journal-${j.collection_id}`}><div><span className="marketplace-seller-fees__reference">{j.collection_id}</span>
          <span>{labels[j.status]}</span><span className="marketplace-seller-fees__money">Bruto autorizado: {money(j.gross_amount_cents)}</span></div>
          <Button variant="outline" disabled={busy} onClick={() => void reviewJournal(j)}>Revisar cobrança</Button></li>)}
      </ul>}
      {(history.length > 0 || historyNext || historyCursors.length > 1) && <nav className="marketplace-seller-fees__pagination" aria-label="Páginas do histórico de cobranças">
        <Button variant="outline" data-testid={feeId("history-previous")} disabled={busy || historyCursors.length === 1} onClick={() => { const stack = historyCursors.slice(0, -1); void historyPage(stack[stack.length - 1], stack); }}>Anterior</Button>
        <span>Página {historyCursors.length}</span><Button variant="outline" data-testid={feeId("history-next")} disabled={busy || !historyNext} onClick={() => { if (historyNext) void historyPage(historyNext, [...historyCursors, historyNext]); }}>Próxima</Button>
      </nav>}
    </section>}
  </div>;
}
