import { useEffect, useRef, useState } from "react";
import type { MetaAdsAsset, MetaAdsConnection } from "@zyon/shared-types";
import type { MetaAdsAgentApi, MetaAdsSelection } from "../../api/endpoints/meta-ads-agent.js";
import { useAction } from "./presentation.js";
const selection = (c: MetaAdsConnection): MetaAdsSelection => ({accountId: c.account?.id ?? "", pageId: c.page?.id ?? null, catalogId: c.catalog?.id ?? null, datasetId: c.dataset?.id ?? null, whatsappId: c.whatsapp?.id ?? null});
function navigateMeta(url: string) {const target = new URL(url); if (target.protocol !== "https:" || !["www.facebook.com", "facebook.com"].includes(target.hostname)) throw new Error("invalid_oauth_url"); window.location.assign(target.href);}
export function ConnectionPanel({connection, entitled, api, onUpdated, navigate = navigateMeta}: {connection: MetaAdsConnection; entitled: boolean; api: MetaAdsAgentApi; onUpdated: () => void | Promise<void>; navigate?: (url: string) => void}) {
  const [view, setView] = useState(connection); const [selected, setSelected] = useState(() => selection(connection)); const [review, setReview] = useState(false); const [notice, setNotice] = useState(""); const callback = useRef(false); const action = useAction();
  const saved=useRef(JSON.stringify({epoch:connection.epoch,status:connection.status,...selection(connection)}));
  useEffect(() => {setView(connection);const next=JSON.stringify({epoch:connection.epoch,status:connection.status,...selection(connection)});if(next!==saved.current){setSelected(selection(connection));saved.current=next;}}, [connection]);
  useEffect(() => {
    const url = new URL(window.location.href); const code = url.searchParams.get("code"), state = url.searchParams.get("state");
    if (callback.current || !entitled || url.searchParams.get("tab") !== "meta-ads-agent" || (!code && !url.searchParams.has("error"))) return;
    callback.current = true; url.searchParams.delete("code"); url.searchParams.delete("state"); const rejected = url.searchParams.has("error"); url.searchParams.delete("error"); url.searchParams.delete("error_description"); url.searchParams.delete("error_reason"); window.history.replaceState(window.history.state, "", url);
    if (rejected || !code || !state) {setNotice("Autorização não concluída. Use Conectar Meta para tentar novamente."); return;}
    void action.run(async () => {const result = await api.completeConnection(state, code); setView(result); setSelected(selection(result)); setNotice("Conexão autorizada. Selecione a conta e os ativos desta loja."); await onUpdated();});
  });
  const scoped = (assets: MetaAdsAsset[]) => assets.filter(a => !a.accountId || a.accountId === selected.accountId);
  const assetSelect = (label: string, field: keyof MetaAdsSelection, assets: MetaAdsAsset[]) => <label>{label}<select aria-label={label} value={selected[field] ?? ""} disabled={!entitled || action.busy} onChange={e => {const value=e.target.value||null;setSelected(current=>({...current,[field]:value,...(field === "pageId" ? {whatsappId: null} : {})}));}}><option value="">Não selecionado</option>{scoped(assets).map(a => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}</select></label>;
  const connected = ["connected", "limited", "authorizing", "reconnect_required"].includes(view.status);
  return <section className="mga-panel" aria-labelledby="mga-connection-title"><h2 id="mga-connection-title">Conexão com a Meta</h2>
    <p role="status">{view.status === "connected" ? "Conectada" : view.status === "limited" ? "Conectada com limitações" : view.status === "reconnect_required" ? "Autorize novamente para continuar" : view.status === "authorizing" ? "Autorização em andamento" : "Desconectada"}</p>
    {!view.oauthConfigured && <p>A conexão ainda não está disponível. Solicite a configuração ao suporte.</p>}
    <button type="button" disabled={!entitled || !view.oauthConfigured || action.busy} onClick={() => void action.run(async () => {const result = await api.startConnection(); navigate(result.authorizationUrl);})}>{action.busy ? "Consultando Meta…" : connected ? "Autorizar novamente" : "Conectar Meta"}</button>
    {connected && <div className="mga-form"><label>Conta de anúncios<select aria-label="Conta de anúncios" value={selected.accountId} disabled={!entitled || action.busy} onChange={e => setSelected({accountId: e.target.value})}><option value="">Selecione a conta</option>{view.accounts.map(a => <option key={a.id} value={a.id}>{a.name} ({a.id})</option>)}</select></label>
      <button type="button" className="mga-secondary" disabled={!entitled || action.busy || !selected.accountId} onClick={() => void action.run(async () => {const result = await api.selectConnection({accountId: selected.accountId}); setView(result); setSelected(selection(result)); setNotice("Ativos da conta carregados. Selecione os destinos e salve."); await onUpdated();})}>Carregar ativos da conta</button>
      {assetSelect("Página", "pageId", view.pages)}{assetSelect("Catálogo Meta", "catalogId", view.catalogs)}{assetSelect("Pixel / conjunto de dados", "datasetId", view.datasets)}{assetSelect("WhatsApp vinculado à página", "whatsappId", view.whatsappNumbers.filter(a => a.pageId === selected.pageId))}
      <p>Para vendas na loja, selecione o conjunto de dados e configure o mesmo ID de Pixel nas configurações da vitrine. O envio de eventos respeita o consentimento do comprador. WhatsApp precisa estar vinculado à página e à conta selecionadas.</p>
      {!view.catalogs.length && <p>Catálogo sem acesso. Você pode usar produtos do catálogo da loja; revise a autorização para usar o catálogo Meta.</p>}
      {!view.datasets.length && <p>Conjunto de dados indisponível. Revise as permissões antes de preparar vendas na loja.</p>}
      {!view.whatsappNumbers.length && <p>WhatsApp sem vínculo autorizado nesta conta.</p>}
      {!view.capabilities.prepare && <p>A preparação de anúncios está indisponível nesta conexão.</p>}
      {view.lastError && <p role="status">A Meta retornou uma limitação. Autorize novamente e confira os ativos disponíveis.</p>}
      <button type="button" disabled={!entitled || action.busy || !selected.accountId} onClick={() => void action.run(async () => {const result = await api.selectConnection({...selected, pageId: selected.pageId ?? null, catalogId: selected.catalogId ?? null, datasetId: selected.datasetId ?? null, whatsappId: selected.whatsappId ?? null}); setView(result); setSelected(selection(result)); setNotice("Ativos atualizados. Propostas anteriores precisam ser revisadas novamente."); await onUpdated();})}>Salvar ativos</button>
    </div>}
    {action.error && <p role="alert">{action.error}</p>}{notice && <p role="status">{notice}</p>}
    {connected && <button type="button" className="mga-secondary" disabled={action.busy} onClick={() => setReview(true)}>Desconectar Meta</button>}
    <details className="mga-connection-guidance mga-inline-details"><summary>Sobre a conexão</summary><p>Use a conta da sua loja. A autorização define quais contas, páginas e catálogos ficam disponíveis.</p></details>
    {review && <div className="mga-notice"><p>As campanhas podem continuar consumindo verba na Meta. A desconexão bloqueia novas operações e invalida aprovações; para parar os anúncios, aprove a pausa antes de desconectar ou use o Gerenciador de Anúncios.</p><div className="mga-actions"><button type="button" disabled={action.busy} onClick={() => void action.run(async () => {await api.disconnect(); setReview(false); setView({...view, status: "disconnected"}); setNotice("Meta desconectada. As campanhas externas não foram pausadas."); await onUpdated();})}>Confirmar desconexão</button><button type="button" className="mga-secondary" disabled={action.busy} onClick={() => setReview(false)}>Manter conexão</button></div></div>}
  </section>;
}
