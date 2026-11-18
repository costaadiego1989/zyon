import { useRef, useState } from 'react';
import type { MetaAdsCampaign, MetaAdsGeneration, MetaAdsOverview, MetaAdsProposal } from '@zyon/shared-types';
import type { MetaAdsAgentApi } from '../../api/endpoints/meta-ads-agent.js';
import { ProposalReview } from './ProposalReview.js';
import { executionStates, generationFeedback, money, priorities, useAction } from './presentation.js';
export interface CampaignChatArtifactProps {
  campaign:MetaAdsCampaign; overview:MetaAdsOverview; api:MetaAdsAgentApi; busy?:boolean;
  onUpdated:()=>void|Promise<void>; onRequest:(message:string)=>Promise<void>;
  onReview?:()=>void;
}
const generations:Record<MetaAdsGeneration['status'],string>={reserved:'Geração na fila',running:'Gerando criativos',succeeded:'Criativos gerados',partial:'Geração parcial',failed:'Falha confirmada na geração',unknown:'Geração com resultado desconhecido. Consulte o histórico antes de solicitar novamente.'};
export function CampaignChatArtifact({campaign,overview,api,busy,onUpdated,onRequest,onReview}:CampaignChatArtifactProps) {
  const action=useAction(),keys=useRef(new Map<string,string>());const [count,setCount]=useState(1),[localJob,setLocalJob]=useState<MetaAdsGeneration|null>(null),[localProposal,setLocalProposal]=useState<MetaAdsProposal|null>(null);
  const key=(intent:string)=>{if(!keys.current.has(intent))keys.current.set(intent,crypto.randomUUID());return keys.current.get(intent)!;};
  const jobs=[...new Map([...(localJob?[localJob]:[]),...overview.generations.filter(g=>g.campaignId===campaign.id)].map(g=>[g.id,g])).values()];
  const pendingGeneration=jobs.some(g=>['reserved','running','unknown'].includes(g.status));
  const executions=overview.executions.filter(e=>e.campaignId===campaign.id);
  const pendingExecution=executions.some(e=>['reserved','sending','publishing','execution_unknown'].includes(e.status));
  const disabled=!overview.entitled||busy||action.busy||pendingGeneration||pendingExecution;
  const owned=campaign.createdByAgent&&campaign.managed;const {draft}=campaign;
  const media=overview.media.filter(m=>m.campaignId===campaign.id&&m.commercialReview?.status==='verified');
  const proposals=[...new Map([...(localProposal?[localProposal]:[]),...overview.proposals.filter(p=>p.campaignId===campaign.id)].map(p=>[p.id,p])).values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const latest=proposals[0];const credits=overview.wallet.monthlyAvailable+overview.wallet.extraAvailable;
  async function generate(){const intent=JSON.stringify({type:'generate',campaign:campaign.id,draft,count,jobs:overview.generations.filter(g=>g.campaignId===campaign.id).map(g=>g.id).sort()});const result=await api.generate(campaign.id,count,key(intent));setLocalJob(result);await onUpdated();return result;}
  async function propose(){const kind=campaign.remoteCampaignId?'publish':'prepare';const reasoning=kind==='prepare'?'Preparar esta campanha em rascunho ou pausada para revisão.':'Solicitar publicação da campanha revisada.';
    const input={kind,after:{},reasoning,idempotencyKey:key(JSON.stringify({kind,campaign:campaign.id,draft}))} as const;setLocalProposal(await api.propose(campaign.id,input));await onUpdated();}
  if(onReview)return <article className="mga-chat-campaign" aria-label={`Campanha ${draft.name}`}><h3>{draft.name}</h3>{campaign.status!=='draft'&&<p>{executionStates[campaign.status]}</p>}<p><strong>{draft.headline}</strong></p><small>{campaign.products.map(product=>`${product.name} · ${money(product.priceCents,product.currency)} · Estoque: ${product.stockQuantity??'não informado'}`).join(' · ')}</small><p>{draft.budget?`${money(draft.budget.amountCents,draft.budget.currency)} ${draft.budget.cadence==='lifetime'?'no total':'por dia'}`:'Orçamento a definir'} · {draft.destination==='store'?'Loja online':'WhatsApp'}</p><button type="button" className="mga-secondary" onClick={onReview}>{campaign.remoteCampaignId?'Ver campanha':'Ver preparo da campanha'}</button></article>;
  return <article className="mga-chat-campaign" aria-label={`Campanha ${draft.name}`}>
    <h3>{draft.name}</h3><p>{campaign.status==='draft'?'Rascunho salvo':executionStates[campaign.status]}</p>
    <dl className="mga-ledger"><div><dt>Destino e prioridade</dt><dd>{draft.destination==='store'?'Loja':'WhatsApp'} · {priorities[draft.priority]}</dd></div><div><dt>Região</dt><dd>{draft.country}</dd></div>
      <div><dt>Orçamento de mídia</dt><dd>{draft.budget?<>{money(draft.budget.amountCents,draft.budget.currency)} · {draft.budget.cadence==='lifetime'?'total do período':'diário'}<br/><time dateTime={draft.budget.startsAt}>{new Date(draft.budget.startsAt).toLocaleString('pt-BR',{timeZoneName:'short'})}</time>{draft.budget.endsAt?<> até <time dateTime={draft.budget.endsAt}>{new Date(draft.budget.endsAt).toLocaleString('pt-BR',{timeZoneName:'short'})}</time></>:' · sem término definido'}</>: 'Esclareça o orçamento na conversa antes de preparar.'}</dd></div>
    </dl>
    <ul>{campaign.products.map(product=><li key={product.variantId}>{product.name} · {product.sku} · {money(product.priceCents,product.currency)} · Estoque: {product.stockQuantity??'não informado'}{!product.active&&' · indisponível'}</li>)}</ul>
    <p><strong>{draft.headline||'Título ainda não definido'}</strong></p><p>{draft.primaryText||'Texto ainda não definido'}</p>
    {!!media.length&&<ol className="mga-media-list">{media.map(image=><li key={image.id}><img src={image.url} alt={`Criativo de ${campaign.products.find(p=>p.variantId===image.variantId)?.name??'produto selecionado'}`} loading="lazy"/><small>{draft.mediaIds.includes(image.id)?'Selecionado para esta campanha':'Disponível para seleção na conversa'}</small></li>)}</ol>}
    {draft.mediaIds.length>1&&<p>Carrossel com {draft.mediaIds.length} imagens, na ordem revisada.</p>}
    {!owned?<p>Somente leitura. Esta campanha não pode ser alterada pelo agente.</p>:<>
      <p>A geração usa seus créditos de imagens. Não compra extras. A verba dos anúncios é paga à Meta; preparar mantém os objetos pausados.</p>
      <label>Quantidade de imagens<select aria-label="Quantidade de imagens" value={count} disabled={disabled} onChange={e=>setCount(Number(e.target.value))}>{Array.from({length:10},(_,i)=>i+1).map(n=><option key={n} value={n}>{n}</option>)}</select></label>
      <small>{credits} crédito(s) disponível(is). Cada imagem nova usa um crédito.</small>
      <div className="mga-actions"><button type="button" disabled={disabled||count>credits} onClick={()=>void action.run(generate,generationFeedback)}>Gerar criativos</button>
        <button type="button" className="mga-secondary" disabled={disabled||!draft.budget||!draft.mediaIds.length} onClick={()=>void action.run(propose,"Proposta criada. Revise os detalhes antes de aprovar.")}>{campaign.remoteCampaignId?'Solicitar publicação':'Solicitar preparo pausado'}</button>
        <button type="button" className="mga-secondary" disabled={disabled} onClick={()=>void action.run(()=>onRequest(`Quero revisar os dados e criativos da campanha ${draft.name} (${campaign.id}), preservando o planejamento.`))}>Revisar pela conversa</button></div>
      {!draft.mediaIds.length&&<p>Selecione os criativos pela conversa antes de preparar. Você pode pedir uma imagem simples ou um carrossel.</p>}
      {localProposal&&<p>Nenhuma alteração enviada à Meta. Revise a proposta abaixo.</p>}
    </>}
    {jobs.map(job=><p role="status" key={job.id}>{generations[job.status]} · {job.mediaIds.length}/{job.requestedImages} imagens.</p>)}
    {executions.map(execution=><p role="status" key={execution.id}>{executionStates[execution.status]}</p>)}
    {owned&&latest&&<ProposalReview key={latest.id} proposal={latest} execution={executions.find(e=>e.proposalId===latest.id)} entitled={overview.entitled} connectionEpoch={overview.connection.epoch} api={api} onUpdated={onUpdated}/>}
    {action.busy&&<p role="status">Confirmando solicitação…</p>}{action.error&&<p role="alert">{action.error}</p>}
  </article>;
}
