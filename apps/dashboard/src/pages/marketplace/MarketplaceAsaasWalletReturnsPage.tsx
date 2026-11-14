import React, { useCallback, useEffect, useRef, useState } from "react";
import { Undo2 } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import type { AsaasWalletReturnEntry, AsaasWalletReturnJournal, AsaasWalletReturnPreview,
  AsaasWalletReturnState, marketplaceAsaasWalletReturnEndpoints } from "../../api/endpoints/marketplace-asaas-wallet-returns.js";
import { useApi } from "../../hooks/useApi.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { PageHeader } from "../../components/PageHeader.js";
import { rememberWalletReturnSubmission, walletReturnSubmissionExists, type WalletReturnScope } from "./asaas-wallet-return-command-state.js";
import "./marketplace-refunds.css";
import "./marketplace-asaas-wallet-returns.css";

type Api = ReturnType<typeof marketplaceAsaasWalletReturnEndpoints>;
const labels: Record<AsaasWalletReturnState | "awaiting_consent", string> = {
  awaiting_consent: "Aguardando autorização", claimed: "Autorizado, aguardando envio", unknown: "Envio sem confirmação",
  pending: "Aguardando confirmação", returned: "Retorno confirmado", failed: "Retorno não concluído",
};
const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
const entryKey = (entry: AsaasWalletReturnEntry) => `${entry.refund_id}:${entry.payout_id}`;
function requireSame(entry: AsaasWalletReturnEntry, view: AsaasWalletReturnPreview): void {
  if (entry.refund_id !== view.refund_id || entry.payout_id !== view.payout_id || entry.amount_cents !== view.amount_cents ||
    entry.journal && (view.status === "awaiting_consent" || entry.journal.id !== view.id || entry.journal.request_hash !== view.request_hash ||
      entry.journal.certificate_hash !== null && entry.journal.certificate_hash !== view.certificate_hash)) throw new Error("wallet_return_changed");
}

export function MarketplaceAsaasWalletReturnsPage({ me }: { me: MerchantProfile }) {
  if (me.role !== "OWNER" && me.role !== "ADMIN") return <EmptyState icon={Undo2} title="Acesso restrito"
    description="Somente proprietários e administradores podem autorizar o retorno de repasses." />;
  return <WalletReturnWorkspace key={`${me.id}:${me.user_id}:${me.role}`} scope={{ merchantId: me.id, userId: me.user_id }} />;
}
function WalletReturnWorkspace({ scope }: { scope: WalletReturnScope }) {
  const api = useApi();
  return <MarketplaceAsaasWalletReturnsWorkspace api={api} scope={scope} />;
}

/** Exposed for an isolated browser fixture. Production receives the existing
 * session API and remounts this workspace on merchant/principal changes. */
export function MarketplaceAsaasWalletReturnsWorkspace({ api, scope }: { api: Api; scope: WalletReturnScope }) {
  const [entries, setEntries] = useState<AsaasWalletReturnEntry[]>([]), [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [next, setNext] = useState<string | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState("");
  const [detail, setDetail] = useState<{ entry: AsaasWalletReturnEntry; view: AsaasWalletReturnPreview } | null>(null);
  const [accepted, setAccepted] = useState(false), [submitted, setSubmitted] = useState<Set<string>>(new Set()), [storageBlocked, setStorageBlocked] = useState(false);
  const alive = useRef(true), working = useRef(false), revision = useRef(0), heading = useRef<HTMLHeadingElement>(null);
  const cursor = cursors[cursors.length - 1];
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++; }; }, []);
  useEffect(() => { if (detail) heading.current?.focus(); }, [detail?.entry.refund_id, detail?.entry.payout_id]);

  function readSubmission(journalId: string): boolean {
    try { return walletReturnSubmissionExists(window.localStorage, scope, journalId); }
    catch { setStorageBlocked(true); return true; }
  }
  const load = useCallback(async () => {
    const request = ++revision.current; setLoading(true); setError(null); setEntries([]); setDetail(null); setAccepted(false); setNext(null);
    try {
      const result = await api.listMarketplaceAsaasWalletReturns(cursor);
      if (!alive.current || request !== revision.current) return;
      if (result.next_cursor !== null && result.next_cursor === cursor) throw new Error("repeated_cursor");
      setEntries(result.entries); setNext(result.next_cursor);
      try {
        const store = window.localStorage;
        setSubmitted(current => new Set([...current, ...result.entries.filter(entry => entry.journal &&
          walletReturnSubmissionExists(store, scope, entry.journal.id)).map(entry => entry.journal!.id)]));
      } catch { setStorageBlocked(true); }
    } catch { if (alive.current && request === revision.current) setError("Não foi possível carregar os retornos. Tente novamente."); }
    finally { if (alive.current && request === revision.current) setLoading(false); }
  }, [api, cursor, scope.merchantId, scope.userId]);
  useEffect(() => { void load(); }, [load]);

  function replace(entry: AsaasWalletReturnEntry, journal: AsaasWalletReturnJournal) {
    requireSame(entry, journal);
    const updated = { ...entry, journal };
    setEntries(current => current.map(row => entryKey(row) === entryKey(entry) ? updated : row));
    setDetail(current => current && entryKey(current.entry) === entryKey(entry) ? { entry: updated, view: journal } : current);
  }
  async function review(entry: AsaasWalletReturnEntry) {
    if (working.current) return; working.current = true; setBusy(true); setError(null); setAccepted(false); setDetail(null);
    try {
      const view = await api.previewMarketplaceAsaasWalletReturn(entry.refund_id, entry.payout_id);
      if (!alive.current) return; requireSame(entry, view);
      if (view.status !== "awaiting_consent") {
        if (readSubmission(view.id)) setSubmitted(current => new Set(current).add(view.id));
        replace(entry, view);
      }
      setDetail({ entry: { ...entry, journal: view.status === "awaiting_consent" ? null : view }, view });
    } catch { if (alive.current) setError("Não foi possível revisar este retorno. Atualize a lista antes de prosseguir."); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function refresh(entry: AsaasWalletReturnEntry) {
    if (working.current) return; working.current = true; setBusy(true); setError(null); setAccepted(false);
    try {
      const view = entry.journal ? await api.observeMarketplaceAsaasWalletReturn(entry.journal.id)
        : await api.previewMarketplaceAsaasWalletReturn(entry.refund_id, entry.payout_id);
      if (!alive.current) return; requireSame(entry, view);
      if (view.status !== "awaiting_consent") {
        replace(entry, view);
        if (readSubmission(view.id)) setSubmitted(current => new Set(current).add(view.id));
      }
      setNotice(view.status === "claimed" && readSubmission(view.id) ? "O envio ainda não foi confirmado. Aguarde e consulte novamente." : labels[view.status]);
    } catch { if (alive.current) setError("Não foi possível consultar o estado. Aguarde e consulte novamente."); }
    finally { working.current = false; if (alive.current) setBusy(false); }
  }
  async function approve() {
    if (working.current || !detail || detail.view.status !== "awaiting_consent" || !accepted) return;
    const entry = detail.entry; working.current = true; setBusy(true); setError(null);
    try {
      const result = await api.approveMarketplaceAsaasWalletReturn(entry.refund_id, entry.payout_id, entry.amount_cents);
      if (!alive.current) return; replace(entry, result);
      setNotice(result.status === "claimed" ? "Autorização registrada. Revise e confirme o envio abaixo." : labels[result.status]);
    } catch { if (alive.current) setError("Não foi possível confirmar a autorização. Consulte o estado antes de prosseguir."); }
    finally { working.current = false; if (alive.current) { setBusy(false); setAccepted(false); } }
  }
  async function execute() {
    if (working.current || !detail || detail.view.status !== "claimed" || !detail.view.can_execute || !accepted ||
      storageBlocked || submitted.has(detail.view.id)) return;
    const entry = detail.entry, journal = detail.view; working.current = true; setBusy(true); setError(null);
    let markerSaved = false;
    try {
      // Persistent marker precedes POST; reloads and stale claimed responses
      // retain GET-only recovery. A second click cannot pass working.current.
      const store = window.localStorage;
      if (walletReturnSubmissionExists(store, scope, journal.id)) {
        setSubmitted(current => new Set(current).add(journal.id));
        setNotice("Uma solicitação já foi enviada. Consulte o estado do retorno."); return;
      }
      rememberWalletReturnSubmission(store, scope, journal.id); markerSaved = true;
      setSubmitted(current => new Set(current).add(journal.id));
      const result = await api.executeMarketplaceAsaasWalletReturn(journal.id, journal.amount_cents, journal.request_hash);
      if (!alive.current) return; replace(entry, result);
      setNotice(result.status === "claimed" ? "O envio ainda não foi confirmado. Consulte o estado." : labels[result.status]);
    } catch {
      if (alive.current) {
        if (!markerSaved) { setStorageBlocked(true); setError("Não foi possível preservar o controle do envio neste navegador. Reabra esta tela em um navegador que permita salvar dados."); }
        else setError("Não foi possível confirmar o envio. Consulte o estado; esta solicitação não será reenviada.");
      }
    } finally { working.current = false; if (alive.current) { setBusy(false); setAccepted(false); } }
  }
  const view = detail?.view, locked = view && view.status !== "awaiting_consent" && submitted.has(view.id);
  const canConsent = view?.status === "awaiting_consent" || view?.status === "claimed" && view.can_execute && !locked && !storageBlocked;
  const stateText = (entry: AsaasWalletReturnEntry) => entry.journal && submitted.has(entry.journal.id) && entry.journal.status === "claimed"
    ? "Envio sem confirmação" : labels[entry.journal?.status ?? "awaiting_consent"];

  return <div className="marketplace-refunds marketplace-asaas-wallet-returns">
    <PageHeader title="Retornos Asaas" description="Repasses que precisam voltar à loja anfitriã para viabilizar uma devolução."
      actions={<Button variant="outline" disabled={loading || busy} onClick={() => void load()}>Atualizar lista</Button>} />
    <p className="marketplace-refunds__help">Revise o repasse, registre sua autorização e confirme o envio em etapas separadas.</p>
    <div role="status" aria-live="polite" className="marketplace-refunds__notice">{notice}</div>
    {error && <p role="alert" className="marketplace-refunds__error">{error}</p>}
    {loading && <div role="status" aria-label="Carregando retornos" className="marketplace-wallet-returns__skeleton"><span /><span /><span /></div>}
    {!loading && !entries.length && !error && <EmptyState icon={Undo2} title={next || cursors.length > 1 ? "Nenhum retorno nesta página" : "Nenhum retorno disponível"}
      description="Retornos elegíveis e já autorizados aparecem aqui quando uma devolução exige recuperar um repasse Asaas recebido por esta loja." />}
    {!loading && entries.length > 0 && <div className="marketplace-refunds__table-wrap" role="region" aria-label="Retornos de repasses Asaas" tabIndex={0}>
      <table className="marketplace-refunds__table"><thead><tr><th>Devolução</th><th>Repasse a retornar</th><th>Loja anfitriã</th><th>Estado</th><th>Ações</th></tr></thead><tbody>
        {entries.map(entry => <tr key={entryKey(entry)} data-testid={`wallet-return-${entry.refund_id}-${entry.payout_id}`}>
          <th scope="row"><span className="marketplace-refunds__id">{entry.return_id}</span><small>{new Date(entry.created_at).toLocaleDateString("pt-BR")}</small></th>
          <td data-label="Repasse a retornar" className="marketplace-refunds__money">{money(entry.amount_cents)}<small>{entry.payment_method === "pix" ? "Pix" : "Cartão"}</small></td>
          <td data-label="Loja anfitriã">{entry.host_name}<small className="marketplace-wallet-returns__environment">{entry.environment === "test" ? "Ambiente de teste" : "Produção"}</small></td>
          <td data-label="Estado"><span className="marketplace-refunds__state" data-state={entry.journal?.status}>{stateText(entry)}</span></td>
          <td><div className="marketplace-refunds__actions"><Button variant="outline" disabled={busy} onClick={() => void review(entry)}>Revisar retorno</Button>
            <Button variant="ghost" disabled={busy} onClick={() => void refresh(entry)}>Consultar estado</Button></div></td>
        </tr>)}
      </tbody></table>
    </div>}
    {!loading && (entries.length > 0 || next || cursors.length > 1) && <nav className="marketplace-refunds__pagination" aria-label="Páginas de retornos">
      <Button variant="outline" disabled={cursors.length === 1 || busy} onClick={() => setCursors(current => current.slice(0, -1))}>Anterior</Button>
      <span>Página {cursors.length}</span><Button variant="outline" disabled={!next || busy} onClick={() => { if (next) setCursors(current => [...current, next]); }}>Próxima</Button>
    </nav>}
    {detail && <section className="marketplace-refunds__detail" aria-labelledby="wallet-return-review-title">
      <h2 id="wallet-return-review-title" ref={heading} tabIndex={-1}>Revisar retorno do repasse</h2>
      <p>Devolução <span className="marketplace-refunds__reference">{detail.entry.return_id}</span></p>
      <dl className="marketplace-refunds__amounts"><dt>Loja que receberá o retorno</dt><dd>{detail.entry.host_name}</dd>
        <dt>Origem dos fundos</dt><dd>Saldo Asaas desta loja</dd><dt>Ambiente</dt><dd>{detail.entry.environment === "test" ? "Teste" : "Produção"}</dd>
        <dt><strong>Valor integral do repasse a retornar</strong></dt><dd><strong>{money(detail.entry.amount_cents)}</strong></dd></dl>
      <p className="marketplace-refunds__help">O retorno usa o valor integral deste repasse. O saldo que exceder o estorno permanece retido para conciliação.</p>
      <p className="marketplace-refunds__help">O retorno não quita taxas ou dívidas pendentes e não confirma o reembolso ao comprador. A loja anfitriã acompanha a conclusão.</p>
      <p role="status">{view && (locked && view.status === "claimed" ? "Envio sem confirmação" : labels[view.status])}</p>
      {locked && view?.status === "claimed" && <p className="marketplace-refunds__help">Uma solicitação já foi enviada neste navegador. Consulte o estado; o envio não será repetido.</p>}
      {storageBlocked && view?.status === "claimed" && <p role="alert">O controle do envio está indisponível neste navegador. Você pode consultar o estado.</p>}
      {canConsent && <label className="marketplace-refunds__accept"><input type="checkbox" checked={accepted} disabled={busy} onChange={event => setAccepted(event.target.checked)} />
        {view?.status === "awaiting_consent" ? `Autorizo retornar ${money(detail.entry.amount_cents)} à loja ${detail.entry.host_name}.` : `Confirmo enviar agora ${money(detail.entry.amount_cents)} do saldo Asaas desta loja.`}</label>}
      <div className="marketplace-refunds__actions"><Button variant="outline" disabled={busy} onClick={() => { setDetail(null); setAccepted(false); }}>Fechar detalhes</Button>
        <Button variant="outline" disabled={busy} onClick={() => void refresh(detail.entry)}>Consultar estado do retorno</Button>
        {view?.status === "awaiting_consent" && <Button disabled={!accepted || busy} loading={busy} onClick={() => void approve()}>Registrar autorização</Button>}
        {view?.status === "claimed" && view.can_execute && !locked && !storageBlocked && <Button variant="danger" disabled={!accepted || busy} loading={busy} onClick={() => void execute()}>Confirmar envio do retorno</Button>}
      </div>
    </section>}
  </div>;
}
