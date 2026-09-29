import "../components/configuration-form.css";
import React, { useState } from "react";
import { Activity, BookOpenCheck, Copy, Download, ExternalLink, KeyRound, RefreshCw, RotateCcw, Send, Webhook, AlertCircle } from "lucide-react";
import type { MerchantProfile } from "../api-client.js";
import { PageHeader } from "../components/PageHeader.js";
import { EmptyState } from "../components/EmptyState.js";
import { Button } from "../components/Button.js";
import { StatCard } from "./overview/components/StatCard.js";
import { SectionHeader } from "../components/SectionHeader.js";
import { FormField } from "../components/FormField.js";
import { Modal } from "../components/Modal.js";
import { PageLoader } from "../components/PageLoader.js";
import { TabBar } from "../components/TabBar.js";
import { FilterToolbar, FilterSelect } from "../components/FilterToolbar.js";
import { DataPanel } from "../components/DataPanel.js";
import { SetupGuide } from "../components/SetupGuide.js";
import { copyText } from "../utils/clipboard.js";
import { useIntegrationsPage, ALL_EVENTS, ALL_SCOPES } from "./useIntegrationsPage.js";
import "./integrations-page.css";
export { relativeTime } from "./useIntegrationsPage.js";

export function IntegrationsPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const { state, actions, computed } = useIntegrationsPage(props.apiBaseUrl, props.me);
  const { apiKeys, webhooks, deliveries, newKeyName, newSecret, secretKind, selectedScopes, webhookUrl, selectedEvents, message, messageKind, busy, loading, loadError, apiReachable } = state;
  const { load, createKey, revokeKey, createWebhook, testWebhook, replay, toggleEvent, toggleScope, copySecret, setNewKeyName, setWebhookUrl, dismissSecret } = actions;
  const { activeKeysCount, activeWebhooksCount, deliverySuccessRate, documentationRoot, quickstart } = computed;
  const [tab, setTab] = useState("keys");
  const [revoking, setRevoking] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [page, setPage] = useState(1);
  const [copied, setCopied] = useState<string | null>(null);
  const rows = deliveries.filter(d => (status === "all" || d.status === status) && (d.eventType + " " + d.endpointUrl).toLowerCase().includes(query.trim().toLowerCase()));
  const safePage = Math.min(page, Math.max(1, Math.ceil(rows.length / 10)));
  const labels: Record<string,string> = { delivered: "Entregue", failed: "Falhou", pending: "Pendente", queued: "Na fila", retrying: "Nova tentativa" };
  if (!props.me) return <PageHeader title="API e webhooks" description="Faça login para configurar suas integrações." />;
  return <div className="page-container api-integrations-page">
    <PageHeader title="API e webhooks" description="Conecte seus sistemas à loja e acompanhe a entrega dos eventos." actions={<><Button variant="outline" disabled={loading || busy} onClick={() => void load()}><RefreshCw size={16} /> Atualizar</Button><a className="developer-link" href={documentationRoot + "/docs"} target="_blank" rel="noreferrer"><BookOpenCheck size={16} /> Documentação <ExternalLink size={14} /></a></>} />
    <SetupGuide title="Como integrar seus sistemas" steps={[{title:"Crie uma chave de acesso", description:"Defina um nome e selecione apenas as permissões que seu sistema precisa. A chave deve ser usada no servidor."},{title:"Cadastre os eventos",description:"Informe o endereço que recebe os webhooks e escolha quais eventos deseja acompanhar."},{title:"Teste e confira a entrega",description:"Solicite um teste e veja o resultado no histórico. Uma tentativa na fila ainda não confirma o recebimento."}]} />
    {message && <p className={"api-feedback api-feedback--" + messageKind} role={messageKind === "error" ? "alert" : "status"}>{message}</p>}
    {newSecret && <section className="panel api-secret" aria-label="Segredo recém-criado"><SectionHeader title={secretKind === "api" ? "Guarde sua nova chave" : "Guarde o segredo do webhook"} subtitle="Este segredo não será exibido novamente após fechar. Armazene-o em um local seguro no servidor." /><code>{newSecret}</code><div className="api-inline-actions"><Button onClick={() => void copySecret()}><Copy size={16} /> Copiar segredo</Button><Button variant="outline" onClick={dismissSecret}>Já guardei, fechar</Button></div></section>}
    {loading ? <PageLoader variant="section" /> : loadError ? <EmptyState icon={AlertCircle} title="Integrações indisponíveis" description={loadError} action={<Button onClick={() => void load()}>Tentar novamente</Button>} /> : <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginBottom: 20 }}>
        <StatCard
          label="Status API"
          value={apiReachable === null ? "—" : apiReachable ? "Online" : "Offline"}
          icon={<Activity size={16} />}
          accent={apiReachable ? "var(--color-success)" : "var(--color-error)"}
        />
        <StatCard
          label="Chaves ativas"
          value={activeKeysCount}
          icon={<KeyRound size={16} />}
        />
        <StatCard
          label="Webhooks"
          value={activeWebhooksCount}
          icon={<Webhook size={16} />}
        />
        <StatCard
          label="Deliveries"
          value={deliveries.length}
          icon={<Send size={16} />}
          trend={deliveries.length > 0 ? deliverySuccessRate - 100 : undefined}
        />
      </div>


    <TabBar tabs={[{key:"keys",label:"Chaves de acesso"},{key:"webhooks",label:"Webhooks"},{key:"deliveries",label:"Histórico de entregas"}]} activeTab={tab} onTabChange={setTab} />
    {tab === "keys" && <>
      <section className="panel"><div className="configuration-form"><SectionHeader title="Criar chave de acesso" subtitle="Use um nome que identifique o sistema. As permissões limitam o que ele pode consultar e alterar." />
        <div className="api-create-row"><FormField label="Nome da chave" value={newKeyName} onChange={setNewKeyName} disabled={busy} placeholder="Ex.: sistema de estoque" /><Button disabled={busy || !!newSecret || !newKeyName.trim() || !selectedScopes.length} onClick={() => void createKey()}><KeyRound size={16} /> Gerar chave</Button></div>
        <details className="api-permissions"><summary>Permissões da chave <span>{selectedScopes.length} selecionadas</span></summary><p>Revise a lista com quem desenvolve a integração antes de gerar a chave.</p><div className="api-options">{ALL_SCOPES.map(scope => <label key={scope}><input type="checkbox" checked={selectedScopes.includes(scope)} disabled={busy} onChange={() => toggleScope(scope)} /><span>{scope}</span></label>)}</div></details>
        {newSecret && <p className="api-helper">Guarde e feche o segredo exibido acima antes de gerar outro.</p>}
      </div></section>
      <DataPanel title="Chaves cadastradas" isEmpty={!apiKeys.length} empty={{icon:KeyRound,title:"Nenhuma chave criada",description:"Preencha o nome e as permissões acima para autorizar seu primeiro sistema."}}><div className="table-wrap"><table className="data-table"><thead><tr><th>Nome</th><th>Prefixo</th><th>Permissões</th><th>Estado</th><th>Ações</th></tr></thead><tbody>{apiKeys.map(key => <tr key={key.id}><td>{key.name}</td><td><code>{key.keyPrefix}</code></td><td><details><summary>{key.scopes.length} permissões</summary><p className="api-scopes-list">{key.scopes.join(", ")}</p></details></td><td><span className={key.revokedAt ? "badge muted" : "badge ok"}>{key.revokedAt ? "Revogada" : "Ativa"}</span></td><td><Button variant="ghost" disabled={busy || !!key.revokedAt} onClick={() => setRevoking(key.id)}>Revogar</Button></td></tr>)}</tbody></table></div></DataPanel>
      <details className="panel api-example"><summary>Exemplo de chamada e documentação técnica</summary><p>Substitua YOUR_API_KEY pela chave no ambiente do servidor. Não publique o segredo no site ou aplicativo do comprador.</p><pre className="code-block">{quickstart}</pre><div className="api-inline-actions"><Button variant="outline" onClick={async () => setCopied(await copyText(quickstart) ? "Exemplo copiado." : "Não foi possível copiar. Selecione o exemplo manualmente.")}><Copy size={16} /> Copiar exemplo</Button><a href={documentationRoot + "/postman.json"} download><Download size={16} /> Coleção Postman</a><a href={documentationRoot + "/openapi.json"} target="_blank" rel="noreferrer">Especificação OpenAPI</a></div>{copied && <p role="status">{copied}</p>}</details>
    </>}
    {tab === "webhooks" && <>
      <section className="panel"><div className="configuration-form"><SectionHeader title="Cadastrar webhook" subtitle="Seu sistema receberá os eventos selecionados no endereço informado." /><FormField label="Endereço de recebimento" type="url" value={webhookUrl} onChange={setWebhookUrl} disabled={busy} placeholder="https://api.sualoja.com/webhooks" hint="Use o endereço completo do serviço que recebe e valida os eventos." />
      <fieldset className="api-event-fieldset"><legend>Eventos enviados</legend><div className="api-options">{ALL_EVENTS.map(event => <label key={event}><input type="checkbox" checked={selectedEvents.includes(event)} disabled={busy} onChange={() => toggleEvent(event)} /><span>{event}</span></label>)}</div></fieldset>
      <div className="api-inline-actions"><Button disabled={busy || !webhookUrl.trim() || !selectedEvents.length || !!newSecret} onClick={() => void createWebhook()}><Webhook size={16} /> Cadastrar webhook</Button><span className="api-helper">{selectedEvents.length} eventos selecionados</span></div>{newSecret && <p className="api-helper">Guarde e feche o segredo exibido acima antes de cadastrar outro webhook.</p>}</div></section>
      <section className="panel"><SectionHeader title="Webhooks cadastrados" subtitle="O teste registra uma tentativa. Confira o recebimento na aba Histórico de entregas." />{webhooks.length ? <div className="api-webhook-list">{webhooks.map(endpoint => <article key={endpoint.id}><div><strong>{endpoint.url}</strong><details><summary>{endpoint.events.length} eventos</summary><p>{endpoint.events.join(", ")}</p></details></div><span className={endpoint.enabled ? "badge ok" : "badge muted"}>{endpoint.enabled ? "Ativo" : "Pausado"}</span><Button variant="outline" disabled={busy} onClick={() => void testWebhook(endpoint.id)}><Send size={16} /> Testar</Button></article>)}</div> : <EmptyState icon={Webhook} title="Nenhum webhook cadastrado" description="Informe um endereço e selecione os eventos para começar." />}</section>
    </>}
    {tab === "deliveries" && <><p className="api-helper">Tentativas recentes de cada webhook. Atualize a página para consultar novos resultados.</p><FilterToolbar tabs={[{key:"all",label:"Entregas"}]} activeTab="all" onTabChange={() => {}} search={query} onSearchChange={v => { setQuery(v);setPage(1); }} searchPlaceholder="Buscar evento ou endereço" extra={<FilterSelect ariaLabel="Estado da entrega" value={status} onChange={v => {setStatus(v);setPage(1);}} options={[{value:"all",label:"Todos os estados"},{value:"delivered",label:"Entregue"},{value:"failed",label:"Falhou"},{value:"pending",label:"Pendente"}]} />} /><DataPanel title="Histórico de entregas" page={safePage} pageSize={10} total={rows.length} onPageChange={setPage} isEmpty={!rows.length} empty={{icon:Send,title:deliveries.length ? "Nenhuma entrega com estes filtros" : "Nenhuma entrega registrada",description:deliveries.length ? "Ajuste a busca ou limpe os filtros." : "Cadastre um webhook e solicite um teste para acompanhar a primeira tentativa.",action:deliveries.length ? <Button variant="outline" onClick={() => {setQuery("");setStatus("all");setPage(1);}}>Limpar filtros</Button> : undefined}}><div className="table-wrap"><table className="data-table"><thead><tr><th>Evento</th><th>Endereço</th><th>Estado</th><th>Tentativas</th><th>Resposta</th><th>Ações</th></tr></thead><tbody>{rows.slice((safePage-1)*10,safePage*10).map(delivery => <tr key={delivery.id}><td>{delivery.eventType}</td><td>{delivery.endpointUrl}</td><td><span className={"badge " + (delivery.status === "delivered" ? "ok" : delivery.status === "failed" ? "bad" : "muted")}>{labels[delivery.status] ?? delivery.status}</span></td><td>{delivery.attempts}</td><td>{delivery.responseStatus ?? (delivery.error ? "Falha na entrega" : "Aguardando resposta")}</td><td><Button variant="ghost" disabled={busy} onClick={() => void replay(delivery.id)}><RotateCcw size={16} /> Reenviar</Button></td></tr>)}</tbody></table></div></DataPanel></>}
    </>}
    <Modal isOpen={revoking !== null} title="Revogar chave de acesso?" subtitle="Os sistemas que usam esta chave deixarão de acessar a API. Esta ação não pode ser desfeita." presentation="center" size="md" onClose={() => { if (!busy) setRevoking(null); }} footer={<><Button variant="outline" disabled={busy} onClick={() => setRevoking(null)}>Manter chave</Button><Button variant="danger" disabled={busy} onClick={async () => { if (revoking && await revokeKey(revoking)) setRevoking(null); }}>{busy ? "Revogando..." : "Revogar chave"}</Button></>}><p className="api-helper">Chave: <strong>{apiKeys.find(key => key.id === revoking)?.name}</strong></p>{messageKind === "error" && message && <p className="api-feedback api-feedback--error" role="alert">{message}</p>}</Modal>
  </div>;
}
