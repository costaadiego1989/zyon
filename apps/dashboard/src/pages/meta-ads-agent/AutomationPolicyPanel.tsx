import { useEffect, useState } from 'react';
import type { MetaAdsAutomationPolicyInput, MetaAdsAutomationReview, MetaAdsAutomationState } from '@zyon/shared-types';
import { actions, adReason, money, priorities, useAction } from './presentation.js';

export interface AutomationPolicyPanelProps {
  accountId:string|null; state?:MetaAdsAutomationState|null; review?:MetaAdsAutomationReview|null;
  productNames?:Record<string,string>; campaignNames?:Record<string,string>;
  disabled?:boolean; busy?:boolean; error?:string;
  onChooseAutomatic:()=>void|Promise<void>;
  onAccept:(review:MetaAdsAutomationReview)=>Promise<void>; onManual:()=>Promise<void>;
}
function Terms({value,productNames={},campaignNames={}}:{value:MetaAdsAutomationPolicyInput;productNames?:Record<string,string>;campaignNames?:Record<string,string>}) {
  const {scope,limits}=value;
  return <dl className="mga-ledger">
    <div><dt>Produtos autorizados</dt><dd>{scope.variantIds.map(id=>productNames[id]??id).join(', ')}</dd></div>
    <div><dt>Campanhas autorizadas</dt><dd>{scope.campaignIds.length?scope.campaignIds.map(id=>campaignNames[id]??id).join(', '):'Nenhuma campanha existente'}</dd></div>
    <div><dt>Novas campanhas</dt><dd>{scope.allowNewCampaigns?'Preparo permitido; publicação exige aprovação':'Não permitidas'}</dd></div>
    <div><dt>Destino e prioridade</dt><dd>{scope.destination==='store'?'Loja':'WhatsApp'} · {priorities[scope.priority]}</dd></div>
    <div><dt>Região</dt><dd>{scope.country}</dd></div>
    <div><dt>Ações autorizadas</dt><dd>{scope.actions.map(kind=>actions[kind]).join(', ')}</dd></div>
    <div><dt>Teto por campanha</dt><dd>{money(limits.campaignCeilingCents,limits.currency)}</dd></div>
    <div><dt>Teto da loja</dt><dd>{money(limits.storeCeilingCents,limits.currency)}</dd></div>
    <div><dt>Periodicidade e moeda</dt><dd>{limits.cadence==='lifetime'?'total do período':'diário'} · {limits.currency}</dd></div>
    <div><dt>Validade</dt><dd>{[limits.startsAt,limits.endsAt].map((at,i)=><span key={at}>{i?' até ':''}<time dateTime={at}>{new Date(at).toLocaleString('pt-BR',{timeZone:'UTC'})} UTC</time></span>)}</dd></div>
  </dl>;
}
export function AutomationPolicyPanel({accountId,state,review,productNames,campaignNames,disabled,busy,error,onChooseAutomatic,onAccept,onManual}:AutomationPolicyPanelProps) {
  const [acknowledged,setAcknowledged]=useState(false);const action=useAction();
  useEffect(()=>setAcknowledged(false),[review?.digest,review?.version,accountId]);
  const policy=state?.policy?.accountId===accountId?state.policy:null;
  const automatic=state?.mode==='automatic'&&!!policy;
  const currentReview=review?.accountId===accountId?review:null;
  const blocked=disabled||busy||action.busy||!accountId;
  return <section className="mga-panel mga-automation" aria-label="Autonomia dos anúncios"><div className="mga-automation-summary"><div><h2>Autonomia da IA</h2>
    <p><strong>{!state?error?'Modo atual: não confirmado':'Consultando modo de aprovação…':`${error?'Último modo confirmado':'Modo atual'}: ${automatic?'automático':'aprovação manual'}`}</strong></p>
    </div>
    <div className="mga-actions"><button type="button" className="mga-secondary" disabled={blocked} onClick={()=>void action.run(async()=>{await onChooseAutomatic();})}>Automático</button>
      {policy&&!policy.revokedAt&&<button type="button" className="mga-secondary" disabled={busy||action.busy} onClick={()=>void action.run(onManual)}>Voltar para aprovação manual</button>}</div></div>
    <p>Toda campanha nova exige aprovação administrativa antes de publicar.</p>{!state&&<p>Confira a política atual antes de autorizar ações. A falta de uma leitura não confirma que a automação esteja desativada.</p>}
    {!automatic&&state&&!error&&!currentReview&&<details className="mga-inline-details"><summary>Como funciona a aprovação</summary><p>Cada alteração na Meta exige sua aprovação individual. Escolher automático inicia a definição de uma política; só o aceite dos termos abaixo autoriza ações futuras.</p></details>}
    {policy&&<details className="mga-inline-details"><summary>Ver política e limites</summary><p>Política {policy.version} · Conta {policy.accountId} · aceita em <time dateTime={policy.acceptedAt}>{new Date(policy.acceptedAt).toLocaleString('pt-BR',{timeZoneName:'short'})}</time></p>
      <Terms value={policy} productNames={productNames} campaignNames={campaignNames}/>
      <p>Compromisso registrado: {money(state!.committedCents)}. Disponível no teto: {money(state!.availableCents)}.</p>
      <p>Voltar ao manual impede novos envios e não desfaz operações já recebidas pela Meta. Não pausa anúncios existentes.</p>
      <p>Histórico de ações já enviadas permanece nos relatórios e nas propostas.</p>
    </details>}
    {currentReview&&<div className="mga-policy-review"><h3>Revise a política automática</h3><p>Conta {currentReview.accountId} · Versão {currentReview.version}</p>
      <Terms value={currentReview} productNames={productNames} campaignNames={campaignNames}/>
      {!!currentReview.warnings.length&&<ul>{currentReview.warnings.map(warning=><li key={warning}>{adReason(warning)}</li>)}</ul>}
      <p>Os tetos incluem operações em andamento e de resultado desconhecido. A IA não pode elevar esses limites nem alterar campanhas de terceiros.</p>
      <label className="mga-ack"><input type="checkbox" checked={acknowledged} disabled={blocked} onChange={event=>setAcknowledged(event.target.checked)}/>Li e autorizo as ações, os produtos, as campanhas e os tetos desta política.</label>
      <button type="button" disabled={blocked||!acknowledged} onClick={()=>void action.run(async()=>{await onAccept(currentReview);setAcknowledged(false);})}>Aceitar política automática</button>
    </div>}
    {action.busy&&<p role="status">Confirmando política…</p>}{(action.error||error)&&<p role="alert">{error||action.error}</p>}
  </section>;
}
