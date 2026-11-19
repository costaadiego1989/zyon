import {useEffect,useRef,useState} from 'react';
import type {MetaAdsCampaignLaunchReview} from '@zyon/shared-types';
import type {CampaignApprovalApi} from './api.js';
import {errorMessage,executionFeedback,executionStates,money,priorities} from './presentation.js';
import {showToast} from '../../components/Toast.js';
import {ChevronLeft,ChevronRight} from 'lucide-react';
import './launch-review.css';

interface Props {
  merchantId:string;value:MetaAdsCampaignLaunchReview|null;api:Pick<CampaignApprovalApi,'review'|'approveLaunch'>;
  timezone?:string;loading?:boolean;error?:string;onRetry?:()=>void;entitled?:boolean;
  onUpdated:(value:MetaAdsCampaignLaunchReview)=>void|Promise<void>;onReconcile?:(executionId:string)=>Promise<unknown>;
  onSetup?:()=>void;onCorrectBudget?:()=>void;
}
export function LaunchReview(props:Props){
  if(props.loading)return <section className="mga-launch" aria-label="Revisão da campanha" aria-busy="true"><p role="status">Carregando revisão…</p></section>;
  if(props.error)return <section className="mga-launch"><p role="alert">{props.error}</p>{props.onRetry&&<button type="button" className="mga-secondary" onClick={props.onRetry}>Atualizar revisão</button>}</section>;
  if(!props.value)return <p className="mga-empty">A campanha ainda está sendo preparada. A revisão aparecerá aqui.</p>;
  return <ReadyReview key={`${props.merchantId}:${props.value.proposal.id}:${props.value.proposal.digest}:${props.value.proposal.connectionEpoch}`} {...props} value={props.value}/>;
}
function ReadyReview({value,api,onUpdated,onReconcile,timezone,entitled=true,onSetup,onCorrectBudget}:Props&{value:MetaAdsCampaignLaunchReview}){
  const [result,setResult]=useState<MetaAdsCampaignLaunchReview|null>(null),[busy,setBusy]=useState(false),[uncertain,setUncertain]=useState(false),[error,setError]=useState('');
  const [previews,setPreviews]=useState<Record<string,'loaded'|'failed'>>({}),[imageAttempt,setImageAttempt]=useState(0);
  const [slide,setSlide]=useState(0);
  const lock=useRef(false),alive=useRef(true),key=useRef<string|null>(null);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  // Once admitted, a lagging overview must not reopen the same approval.
  useEffect(()=>{setResult(previous=>{
    if(previous&&(previous.proposal.approvedAt||previous.execution)&&value.proposal.status==='pending_review'&&!value.execution)return previous;
    if(previous?.execution&&value.execution?.id===previous.execution.id&&value.execution.updatedAt<previous.execution.updatedAt)return previous;
    return value;
  });},[value]);
  const current=result??value;
  const {campaign,proposal,execution}=current,draft=campaign.draft,budget=draft.budget;
  const media=draft.mediaIds.map(id=>current.media.find(image=>image.id===id)).filter(image=>!!image);
  const previewReady=media.length===draft.mediaIds.length&&media.length>0&&media.every(image=>previews[image.id]==='loaded');
  const previewFailed=Object.values(previews).includes('failed');
  const approved=proposal.status==='approved'||!!proposal.approvedAt||!!execution;
  const unknown=uncertain||execution?.status==='execution_unknown';
  const formatTime=(value:string)=>new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:timezone}).format(new Date(value));
  const budgetIssue=current.missing.some(code=>code.startsWith('campaign_budget_')),setupIssue=current.missing.some(code=>['meta_whatsapp_not_linked','meta_dataset_required','meta_page_required','meta_account_required','meta_connection_required'].includes(code));
  const reason=current.missing.includes('proposal_stale')?'A campanha mudou. Atualize o planejamento e revise a nova versão.':budgetIssue?'A verba precisa ser conferida para essas datas antes da publicação.':current.missing.includes('meta_whatsapp_not_linked')?'Vincule o número à Página na Meta para publicar este anúncio no WhatsApp.':current.missing.includes('meta_dataset_required')?'Selecione o Pixel da loja antes de publicar.':setupIssue?'Conclua a conexão da conta e da Página da loja na Meta.':'Atualize a revisão para conferir a pendência antes de publicar.';
  async function approve(){
    if(lock.current||!entitled||!current.canApprove||!previewReady||approved||unknown)return;
    lock.current=true;setBusy(true);setError('');key.current??=crypto.randomUUID();
    try{const next=await api.approveLaunch(campaign.id,proposal.id,{digest:proposal.digest,idempotencyKey:key.current});if(alive.current){setResult(next);const message=next.execution?executionFeedback(next.execution):{type:'success' as const,text:'Aprovação registrada. Aguardando envio à Meta.'};showToast(message.type,message.text);void onUpdated(next);}}
    catch(e){if(alive.current){setUncertain(true);setError(errorMessage(e));showToast('error',errorMessage(e));}}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  async function consult(){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');
    try{
      if(execution&&['execution_unknown','publishing','active_unconfirmed','remote_draft','remote_paused'].includes(execution.status)&&onReconcile)await onReconcile(execution.id);
      const next=await api.review(campaign.id,proposal.id);
      if(alive.current){setResult(next);if(next.proposal.status!=='pending_review'||next.execution)setUncertain(false);const message=next.execution?executionFeedback(next.execution):{type:'success' as const,text:'Revisão atualizada. Confira o estado da aprovação.'};showToast(message.type,message.text);void onUpdated(next);}
    }catch(e){if(alive.current){setError(errorMessage(e));showToast('error',errorMessage(e));}}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  return <section className="mga-launch" aria-label={`Revisão: ${draft.name}`}>
    <header className="mga-section-heading"><div><h2>{draft.name}</h2><p>{approved?'Aprovação registrada':current.canApprove?'Pronta para sua aprovação':'Revisão pendente'}</p></div></header>
    <div className="mga-launch-layout"><div className="mga-launch-creative">
      <div className="mga-launch-carousel" role="region" aria-roledescription="carrossel" aria-label="Prévia dos criativos" tabIndex={media.length>1?0:undefined} onKeyDown={event=>{if(event.key==='ArrowRight'){event.preventDefault();setSlide(index=>Math.min(media.length-1,index+1));}else if(event.key==='ArrowLeft'){event.preventDefault();setSlide(index=>Math.max(0,index-1));}}}>
        <ol className="mga-launch-previews" aria-label={media.length>1?'Ordem do carrossel':'Criativo'}>{media.map((image,index)=><li key={image.id} hidden={index!==slide}><img key={`${image.id}:${imageAttempt}`} src={image.url} alt={`Criativo ${index+1}: ${campaign.products.find(p=>p.variantId===image.variantId)?.name??'produto selecionado'}`} onLoad={()=>setPreviews(previous=>({...previous,[image.id]:'loaded'}))} onError={()=>setPreviews(previous=>({...previous,[image.id]:'failed'}))}/></li>)}</ol>
        <div className={`mga-slide-controls${media.length<2?' mga-slide-controls-single':''}`}>
          {media.length>1&&<button type="button" className="mga-secondary mga-slide-arrow" aria-label="Criativo anterior" disabled={slide===0} onClick={()=>setSlide(index=>index-1)}><ChevronLeft size={20} aria-hidden="true"/></button>}
          <span aria-live="polite" aria-atomic="true">{slide+1} de {media.length}{media.length>1?' · Carrossel':''}</span>
          {media.length>1&&<button type="button" className="mga-secondary mga-slide-arrow" aria-label="Próximo criativo" disabled={slide===media.length-1} onClick={()=>setSlide(index=>index+1)}><ChevronRight size={20} aria-hidden="true"/></button>}
        </div>
        <small>{media[slide]?.source==='catalog'?'Foto do catálogo':'Imagem do anúncio'}</small>
      </div>
      {previewFailed&&<div role="alert"><p>Não foi possível carregar um criativo. Confira as imagens antes de aprovar.</p><button type="button" className="mga-secondary" onClick={()=>{setPreviews({});setImageAttempt(n=>n+1);}}>Recarregar criativos</button></div>}
      <h3>{draft.headline}</h3><p className="mga-launch-copy">{draft.primaryText}</p>
      <details><summary>Produtos anunciados ({campaign.products.length})</summary><ul className="mga-launch-products">{campaign.products.map(product=><li key={product.variantId}><strong>{product.name}</strong><span>SKU {product.sku} · {money(product.priceCents,product.currency)} · {product.stockQuantity} disponíveis</span></li>)}</ul></details>
    </div><div>
      <dl className="mga-ledger"><div><dt>Objetivo</dt><dd>{priorities[draft.priority]}</dd></div><div><dt>Destino</dt><dd>{draft.destination==='store'?'Loja online':'WhatsApp'}</dd></div><div><dt>Público</dt><dd>{draft.country==='BR'?'Brasil':draft.country}</dd></div>
        <div><dt>Investimento</dt><dd>{budget?`${money(budget.amountCents,budget.currency)} ${budget.cadence==='lifetime'?'no total':'por dia'}`:'Não definido'}</dd></div>
        <div><dt>Início</dt><dd>{budget?.startsAt?<time dateTime={budget.startsAt}>{formatTime(budget.startsAt)}</time>:'Não definido'}</dd></div><div><dt>Término</dt><dd>{budget?.endsAt?<time dateTime={budget.endsAt}>{formatTime(budget.endsAt)}</time>:'Sem data final'}</dd></div>
      </dl>
      <p className="mga-launch-cost">Investimento pago diretamente à Meta. A aprovação autoriza a publicação desta versão.</p>
      {!!current.missing.length&&<p role="alert">{reason}</p>}
      {budgetIssue&&current.budgetAssessment?.estimatedMinimumTotalCents&&<p>Referência para o período: {money(current.budgetAssessment.estimatedMinimumTotalCents,current.budgetAssessment.currency)} no total. Esse valor não garante vendas.</p>}
      <div className="mga-launch-submit">
        {execution?<p role="status">{executionStates[execution.status]}</p>:approved?<p role="status">Aprovação registrada. Aguardando envio à Meta.</p>:unknown?<p role="status">Aguardando confirmação da aprovação. Consulte o estado antes de qualquer nova ação.</p>:<button type="button" data-action="approve-launch" disabled={busy||!entitled||!current.canApprove||!previewReady} onClick={()=>void approve()}>{busy?'Registrando aprovação…':'Aprovar e publicar'}</button>}
        {(unknown||approved)&&<button type="button" className="mga-secondary" disabled={busy} onClick={()=>void consult()}>Consultar estado</button>}
        {!approved&&!unknown&&!current.canApprove&&budgetIssue&&onCorrectBudget&&<button type="button" className="mga-secondary" onClick={onCorrectBudget}>Corrigir verba</button>}
        {!approved&&!unknown&&!current.canApprove&&!budgetIssue&&setupIssue&&onSetup&&<button type="button" className="mga-secondary" onClick={onSetup}>Concluir conexão</button>}
        {!approved&&!unknown&&!previewReady&&!previewFailed&&<small>Carregando criativos para revisão…</small>}
        {busy&&<p role="status">{approved||unknown?'Consultando estado…':'Registrando aprovação…'}</p>}{error&&<p role="alert">{error}</p>}
      </div>
      {!!execution?.objects.length&&<details><summary>Objetos na Meta ({execution.objects.length})</summary><ul>{execution.objects.map(object=><li key={`${object.type}:${object.id}`}>{({campaign:'Campanha',ad_set:'Conjunto',ad:'Anúncio',creative:'Criativo'})[object.type]}: {object.id}</li>)}</ul></details>}
    </div></div>
  </section>;
}
