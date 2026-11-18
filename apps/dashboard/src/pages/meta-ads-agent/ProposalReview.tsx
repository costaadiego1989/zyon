import { useEffect, useState } from "react";
import type { MetaAdsExecution, MetaAdsProposal } from "@zyon/shared-types";
import type { MetaAdsAgentApi } from "../../api/endpoints/meta-ads-agent.js";
import { DashboardHttpError } from "../../api/http/error.js";
import { actions, date, executionFeedback, executionStates, money, priorities, useAction } from "./presentation.js";
type JsonObject = Record<string, unknown>;
const object = (v: unknown): JsonObject => v && typeof v === "object" && !Array.isArray(v) ? v as JsonObject : {};
const labels: Record<string, string> = {status: "Estado", objects: "Objetos afetados", campaign: "Campanha", ad_set: "Conjunto de anúncios", creative: "Criativo", ad: "Anúncio", accountId: "Conta de anúncios", pageId: "Página", datasetId: "Conjunto de dados", whatsappId: "WhatsApp", name: "Nome", headline: "Título", primaryText: "Texto", country: "País", countries: "Países", geo_locations: "Localização", targeting: "Público", creativeIds: "Criativos atuais", productState: "Produtos revisados", stockQuantity: "Estoque", active: "Disponível", sku: "SKU", type: "Tipo", id: "ID", ACTIVE: "Ativo", PAUSED: "Pausado", not_created: "Ainda não criada"};
Object.assign(labels, {objectStates: "Estado dos objetos", effectiveStatus: "Estado efetivo", UNKNOWN: "Não confirmado", IN_PROCESS: "Em processamento", PENDING_REVIEW: "Em análise", CAMPAIGN_PAUSED: "Campanha pausada", ADSET_PAUSED: "Conjunto pausado"});
function Value({value}: {value: unknown}) {
  if (value === null || value === undefined) return <>Não informado</>;
  if (Array.isArray(value)) return <ul>{value.map((v, i) => <li key={i}><Value value={v}/></li>)}</ul>;
  if (typeof value === "object") return <dl className="mga-ledger">{Object.entries(object(value)).filter(([key]) => !["commercialVersion", "productVersion", "imageSha256", "variantId", "productId"].includes(key)).map(([key, v]) => <div key={key}><dt>{labels[key] ?? key.replaceAll("_", " ")}</dt><dd><Value value={v}/></dd></div>)}</dl>;
  return <>{typeof value === "boolean" ? value ? "Sim" : "Não" : labels[String(value)] ?? String(value)}</>;
}
function Snapshot({value}: {value: JsonObject}) {
  const budget = object(value.budget); const amount = budget.amountCents ?? budget.daily_budget ?? budget.lifetime_budget;
  const currency = typeof budget.currency === "string" ? budget.currency : "BRL";
  return <div className="mga-snapshot">
    {value.draft !== undefined && <Snapshot value={object(value.draft)}/>}
    {Object.hasOwn(value, "budget") && <div><strong>Orçamento</strong><p>{amount !== undefined && amount !== null ? `${money(Number(amount), currency)} · ${budget.cadence === "lifetime" || budget.lifetime_budget != null ? "total do período" : "diário"}` : "Não informado"}{typeof budget.startsAt === "string" ? ` · início ${date(budget.startsAt)}` : ""}{typeof budget.endsAt === "string" ? ` · término ${date(budget.endsAt)}` : ""}</p></div>}
    {typeof value.destination === "string" && <p>Destino: {value.destination === "store" ? "Loja" : "WhatsApp"}</p>}
    {typeof value.priority === "string" && <p>Prioridade: {priorities[value.priority as keyof typeof priorities]}</p>}
    {Array.isArray(value.media) && <div className="mga-media-list">{value.media.map((v, i) => {const m = object(v); return typeof m.url === "string" ? <figure key={i}><img src={m.url} alt={`Criativo revisado ${i + 1}`}/><figcaption>Imagem {i + 1}</figcaption></figure> : null;})}</div>}
    {Array.isArray(value.products) && <ul>{value.products.map((v, i) => {const p = object(v); return <li key={i}>{String(p.name)} · {String(p.sku)} · {money(Number(p.priceCents), String(p.currency ?? "BRL"))}</li>;})}</ul>}
    <Value value={Object.fromEntries(Object.entries(value).filter(([key]) => !["draft", "budget", "destination", "priority", "media", "products", "mediaIds", "variantIds"].includes(key)))}/>
  </div>;
}
export function ProposalReview({proposal, execution, entitled, connectionEpoch, api, onUpdated}: {proposal: MetaAdsProposal; execution?: MetaAdsExecution; entitled: boolean; connectionEpoch: number; api: MetaAdsAgentApi; onUpdated: () => void | Promise<void>}) {
  const [view, setView] = useState(proposal); const [result, setResult] = useState(execution); const [uncertain, setUncertain] = useState(false); const [acknowledged, setAcknowledged] = useState(false); const action = useAction();
  const reviewVersion = JSON.stringify([proposal.id, proposal.digest, proposal.campaignId, proposal.kind, proposal.connectionEpoch, proposal.before, proposal.after, proposal.reasoning],
    (_key, value: unknown) => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
  useEffect(() => {setView(proposal);}, [proposal]);
  useEffect(() => {setAcknowledged(false);}, [reviewVersion, connectionEpoch]);
  useEffect(() => {setResult(execution);}, [execution]);
  const stale = view.status === "stale" || view.connectionEpoch !== connectionEpoch;
  const disabled = !entitled || action.busy || stale;
  const reviewed = acknowledged && !disabled;
  return <article className="mga-proposal" aria-labelledby={`proposal-${view.id}`}><header><h3 id={`proposal-${view.id}`}>{actions[view.kind]}</h3><p>{view.reasoning}</p><small>Criada em {date(view.createdAt)} · campanha {view.campaignId}</small></header>
    <div className="mga-comparison"><section><h4>Antes</h4><Snapshot value={view.before}/></section><section><h4>Proposto</h4><Snapshot value={view.after}/></section></div>
    {view.kind === "prepare" && <p>A preparação cria objetos em rascunho ou pausados. A publicação terá sua própria aprovação.</p>}
    {view.kind === "publish" && <p>A publicação pode iniciar o consumo do orçamento acima, pago diretamente à Meta. A aprovação não garante veiculação nem vendas.</p>}
    {stale && <p role="status">Proposta desatualizada. Solicite uma nova proposta e revise novamente.</p>}
    {view.status === "pending_review" && !stale && <><label className="mga-ack"><input type="checkbox" checked={acknowledged} disabled={disabled} onChange={e => setAcknowledged(e.target.checked)}/>Revisei os objetos, os valores e o orçamento desta alteração.</label><div className="mga-actions"><button type="button" data-action="approve" disabled={!reviewed} onClick={() => void action.run(async () => {setView(await api.approve(view.id, view.digest)); await onUpdated();},"Aprovação registrada.")}>{view.kind === "publish" ? "Aprovar publicação" : "Aprovar alteração"}</button><button type="button" className="mga-secondary" disabled={disabled} onClick={() => void action.run(async () => {setView(await api.reject(view.id)); await onUpdated();},"Proposta rejeitada. Nenhuma alteração executada.")}>Rejeitar proposta</button></div></>}
    {view.status === "approved" && !result && !view.executionId && !uncertain && <><p>Aprovação registrada em {date(view.approvedAt)} por {view.approvedBy ?? "usuário autorizado"}.</p><button type="button" disabled={disabled} onClick={() => void action.run(async () => {let result;try {result=await api.execute(view.id);setResult(result);} catch (e) {if (e instanceof DashboardHttpError && e.status >= 400 && e.status < 500) {setView(v => ({...v,status:"stale"})); await onUpdated();} else setUncertain(true); throw e;} await onUpdated();return result;},executionFeedback)}>Executar alteração aprovada</button></>}
    {uncertain && !result && <div className="mga-notice"><p role="status">Resultado desconhecido. Consulte o histórico para identificar o envio e reconciliar o resultado antes de qualquer nova ação.</p><button type="button" className="mga-secondary" disabled={action.busy} onClick={() => void action.run(async () => {await onUpdated();},"Histórico atualizado.")}>Atualizar histórico</button></div>}
    {view.status === "rejected" && <p role="status">Proposta rejeitada. Nenhuma alteração executada.</p>}
    {result && <div className="mga-notice"><p role="status">{view.kind === "prepare" && result.status === "remote_paused" ? "Preparada, sem veiculação" : executionStates[result.status]}</p>{!!result.objects.length && <div><strong>Objetos registrados na Meta</strong><Value value={result.objects}/></div>}{result.error && <p>A operação requer revisão do resultado antes de uma nova proposta.</p>}
      {["sending", "execution_unknown", "publishing", "active_unconfirmed", "remote_draft"].includes(result.status) && <button type="button" className="mga-secondary" disabled={action.busy} onClick={() => void action.run(async () => {const next=await api.reconcile(result.id);setResult(next);await onUpdated();return next;},executionFeedback)}>Consultar estado na Meta</button>}
    </div>}
    {action.busy && <p role="status">Confirmando operação…</p>}{action.error && <p role="alert">{action.error}</p>}
  </article>;
}
