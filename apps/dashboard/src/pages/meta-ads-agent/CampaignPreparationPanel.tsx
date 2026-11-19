import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import type {MetaAdsCampaignLaunchReview,MetaAdsCampaign,MetaAdsMedia,MetaAdsConnection} from '@zyon/shared-types';
import type {CampaignApprovalApi,CampaignPreparationView} from './api.js';
import {LaunchReview} from './LaunchReview.js';
import {errorMessage} from './presentation.js';
import {showToast} from '../../components/Toast.js';
import {RefreshCw} from 'lucide-react';
import {DraftCampaignPreview} from './DraftCampaignPreview.js';import {money} from './presentation.js';
interface Props{merchantId:string;campaignId:string;proposalId?:string;hasLaunch?:boolean;api:CampaignApprovalApi;entitled:boolean;pollMs:number;timezone?:string;selectedImageCount?:number;onUpdated:()=>void|Promise<void>;onReconcile?:(id:string)=>Promise<unknown>;onReviewPendingChange?:(pending:boolean)=>void;campaign?:MetaAdsCampaign|null;media?:MetaAdsMedia[];connection?:MetaAdsConnection;onSetup?:()=>void;onCorrectBudget?:()=>void;}
const states={queued:'Preparação na fila',preparing:'Preparando campanha',creative_pending:'Criando e verificando imagens',review_ready:'Pronta para aprovação',blocked:'Preparação pendente',unknown:'Resultado da preparação desconhecido',superseded:'Planejamento atualizado'};
const blockers:Record<string,string>={campaign_preparation_unavailable:'A preparação está indisponível no momento. Tente consultar novamente.',image_credits_insufficient:'Créditos de imagens insuficientes. Fotos do catálogo não usam créditos; tente concluir com a foto do produto.',meta_connection_required:'Conecte sua conta de anúncios para publicar.',meta_account_required:'Conecte sua conta de anúncios para publicar.',meta_page_required:'Selecione a Página da sua loja na Meta.',meta_whatsapp_not_linked:'O número precisa estar vinculado à Página na Meta. Conectar o atendimento da loja não faz esse vínculo.',meta_dataset_required:'Selecione o Pixel da loja para medir as compras.',campaign_budget_required:'Informe o valor e as datas do anúncio.',campaign_dates_invalid:'Revise as datas do anúncio.',campaign_products_required:'Escolha o produto que será anunciado.',campaign_budget_below_period_minimum:'O valor total está abaixo da referência para esses dias. Ajuste o valor ou reduza o período.',campaign_budget_below_daily_minimum:'O valor por dia está abaixo do mínimo informado pela Meta. Escolha outro valor.',campaign_budget_check_unavailable:'Não foi possível consultar o mínimo da conta. Atualize antes de publicar.',catalog_photo_count_unavailable:'Há menos fotos de produtos do que imagens solicitadas. Ajuste a quantidade de imagens.',catalog_photo_invalid:'Não foi possível preparar a foto. Confira a imagem cadastrada no produto.',catalog_photo_unavailable:'Não foi possível carregar a foto do produto. Atualize para consultar novamente.',catalog_photo_storage_unavailable:'Não foi possível salvar a imagem para aprovação. Consulte novamente mais tarde.'};
export function CampaignPreparationPanel(props:Props){return <Preparation key={`${props.merchantId}:${props.campaignId}:${props.proposalId??''}`} {...props}/>;}
function Preparation({merchantId,campaignId,proposalId,hasLaunch=false,api,entitled,pollMs,timezone,selectedImageCount=0,onUpdated,onReconcile,onReviewPendingChange,campaign,media,connection,onSetup,onCorrectBudget}:Props){
 const [state,setState]=useState<CampaignPreparationView|null>(null),[review,setReview]=useState<MetaAdsCampaignLaunchReview|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[count,setCount]=useState(1);
 const life=useRef<AbortController|null>(null),lock=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),read=useRef<(notify?:boolean)=>Promise<void>>(async()=>{}),updated=useRef(onUpdated);updated.current=onUpdated;
 const knownLaunch=useRef(hasLaunch);knownLaunch.current=hasLaunch;
 const job=state?.preparations[0];
 useLayoutEffect(()=>{onReviewPendingChange?.(!!campaign&&!review||review?.proposal.status==='pending_review');return()=>onReviewPendingChange?.(false);},[campaign?.id,review?.proposal.status,onReviewPendingChange]);
 useEffect(()=>{if(selectedImageCount>0)setCount(selectedImageCount);},[selectedImageCount]);
 useEffect(()=>{
  const controller=new AbortController();life.current=controller;
  const load=async(notify=false)=>{
   if(lock.current||controller.signal.aborted)return;lock.current=true;
   try{
    const next=await api.preparation(campaignId,controller.signal);if(controller.signal.aborted)return;
    next.preparations.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));setState(next);
    const reviewed=next.preparations.filter(job=>job.proposalId),id=proposalId??(reviewed.length===1?reviewed[0].proposalId:undefined);
    let current:MetaAdsCampaignLaunchReview|null=null;
    if(id||knownLaunch.current||reviewed.length){current=await api.review(campaignId,id??undefined,controller.signal);if(controller.signal.aborted)return;setReview(current);}else setReview(null);
    setError('');
    if(notify)showToast('success','Preparo atualizado. Confira o estado da campanha.');
    const pending=next.preparations.some(job=>['queued','preparing','creative_pending'].includes(job.status))||current?.execution&&['reserved','sending','remote_draft','remote_paused','publishing'].includes(current.execution.status)||current?.proposal.status==='approved'&&!current.execution;
    if(pending&&!controller.signal.aborted)timer.current=setTimeout(()=>void load(),pollMs);
   }catch(e){if(!controller.signal.aborted){setError(errorMessage(e));if(notify)showToast('error',errorMessage(e));}}
   finally{lock.current=false;if(!controller.signal.aborted)setLoading(false);}
  };read.current=load;void load();
  return()=>{controller.abort();clearTimeout(timer.current);};
 },[api,campaignId,proposalId,pollMs]);
 useEffect(()=>{if(hasLaunch)void read.current();},[hasLaunch]);
 async function prepare(){
  if(lock.current||!state||!entitled||job?.status==='unknown')return;lock.current=true;setBusy(true);setError('');
  try{const saved=await api.preparation(campaignId,life.current?.signal);if(life.current?.signal.aborted)return;const next=await api.prepare(campaignId,{campaignDigest:saved.campaignDigest,imageCount:job?.requestedImages??count},life.current?.signal);if(!life.current?.signal.aborted){setState({...saved,preparations:[next,...saved.preparations.filter(j=>j.id!==next.id)]});showToast(['blocked','unknown'].includes(next.status)?'error':'success',states[next.status]);lock.current=false;await read.current();void updated.current();}}
  catch(e){if(!life.current?.signal.aborted){setError(errorMessage(e));showToast('error',errorMessage(e));}}
  finally{lock.current=false;if(!life.current?.signal.aborted)setBusy(false);}
 }
 const notice=review?.notice;
 const assessment=state?.budgetAssessment,budgetCode=assessment?.status==='below_estimated_period_minimum'?'campaign_budget_below_period_minimum':assessment?.status==='below_account_minimum'?'campaign_budget_below_daily_minimum':assessment?.status==='minimum_unavailable'?'campaign_budget_check_unavailable':null;
 const connectionCode=!connection?null:!connection.account?'meta_account_required':!connection.page?'meta_page_required':campaign?.draft.destination==='whatsapp'&&!connection.whatsapp?'meta_whatsapp_not_linked':campaign?.draft.destination==='store'&&!connection.dataset?'meta_dataset_required':null;
 const missing=[...new Set([...(budgetCode?[budgetCode]:[]),...(job?.missing??[]),...(connectionCode?[connectionCode]:[])])],knownLow=missing.find(code=>code==='campaign_budget_below_period_minimum'||code==='campaign_budget_below_daily_minimum'),setupCode=missing.find(code=>['meta_account_required','meta_connection_required','meta_page_required','meta_whatsapp_not_linked','meta_dataset_required'].includes(code)),reason=knownLow??setupCode??missing[0];
 const needsSetup=!!setupCode&&!knownLow,needsBudget=!!knownLow||reason==='campaign_budget_required'||reason==='campaign_dates_invalid',working=!!job&&['queued','preparing','creative_pending'].includes(job.status),unknown=job?.status==='unknown';
 return <section aria-label="Preparo e aprovação" className="mga-panel">
  <div className="mga-review-toolbar"><span>{review?'Revisão do anúncio':'Prévia do anúncio'}</span><button type="button" className="mga-secondary" aria-label="Atualizar preparo" title="Atualizar anúncio" disabled={loading||busy} onClick={()=>{clearTimeout(timer.current);void read.current(true);}}><RefreshCw size={18} aria-hidden="true"/></button></div>
  {!review&&<>{campaign&&<DraftCampaignPreview campaign={campaign} media={media} assessment={assessment} timezone={timezone}/>}
   <div className="mga-review-next"><h3>{loading?'Conferindo o anúncio':knownLow?'Vamos revisar a verba':needsSetup?(setupCode==='meta_whatsapp_not_linked'?'Falta vincular o WhatsApp':'Falta concluir a conexão'):unknown?'Aguardando confirmação':working?(job?.status==='queued'?states.queued:'Preparando a imagem para revisão'):reason?'Falta um ajuste':'Confira antes de publicar'}</h3>
   {loading?<p role="status">Consultando os dados atuais…</p>:<p role={reason?'alert':'status'}>{reason?(blockers[reason]??'Não foi possível concluir o anúncio. Atualize para conferir o próximo passo.'):working?'A imagem final vai aparecer aqui assim que estiver pronta.':'O anúncio está salvo. Conclua a preparação da imagem para liberar a aprovação.'}</p>}
   {knownLow&&assessment?.minimumDailyBudgetCents&&<p>{assessment.dailyEquivalentCents!==null&&<>Seu valor equivale a {money(assessment.dailyEquivalentCents,assessment.currency)} por dia. </>}A Meta informa {money(assessment.minimumDailyBudgetCents,assessment.currency)} como mínimo diário.{assessment.estimatedMinimumTotalCents!==null&&<> Para esse período, a referência é {money(assessment.estimatedMinimumTotalCents,assessment.currency)} no total.</>}</p>}
   {unknown&&<p>Resultado da preparação desconhecido. Nenhum envio será repetido automaticamente.</p>}
   <div className="mga-actions"><button type="button" disabled>Aprovar e publicar</button>{needsBudget&&onCorrectBudget?<button type="button" className="mga-secondary" onClick={onCorrectBudget}>Corrigir verba</button>:needsSetup&&onSetup?<button type="button" className="mga-secondary" onClick={onSetup}>{setupCode==='meta_whatsapp_not_linked'?'Vincular WhatsApp':setupCode==='meta_dataset_required'?'Configurar Pixel':'Concluir conexão'}</button>:!unknown&&!working&&(!job||['blocked','superseded'].includes(job.status))&&<button type="button" className="mga-secondary" disabled={busy||!state||!entitled||!!error||loading} onClick={()=>void prepare()}>{job?'Retomar preparo':'Preparar para revisão'}</button>}</div>
   <small>A aprovação libera o envio desta versão à Meta. Antes disso, nenhum anúncio vai ao ar. Nenhum extra será comprado automaticamente.</small>
   </div>
   {!job&&<details className="mga-review-technical"><summary>Opções de imagens</summary><label>Imagens para preparar<select aria-label="Imagens para preparar" value={count} onChange={event=>setCount(Number(event.target.value))}>{Array.from({length:10},(_,i)=><option key={i+1}>{i+1}</option>)}</select></label><p>Fotos do catálogo não usam créditos de geração. Artes novas usam a franquia disponível.</p></details>}
  </>}
  {error&&<p role="alert">{error}</p>}
  {review&&<LaunchReview merchantId={merchantId} value={review} api={api} timezone={timezone} entitled={entitled} onReconcile={onReconcile} onSetup={onSetup} onCorrectBudget={onCorrectBudget} onUpdated={next=>{setReview(next);clearTimeout(timer.current);void read.current();void updated.current();}}/>}
  {notice&&<details className="mga-review-technical"><summary>Avisos de aprovação</summary><p role="status">{notice.reviewState==='approved'?'Campanha aprovada':notice.reviewState==='superseded'?'Aviso de versão anterior':'Aviso no painel'} · WhatsApp: {({queued:'na fila',blocked:'indisponível; o aviso continua no painel',sending:'envio em processamento',accepted:'aceito pela Meta, entrega ainda não confirmada',delivered:'entregue',failed:'falha confirmada',unknown:'resultado desconhecido; sem repetição automática'})[notice.whatsappStatus]}{notice.recipientHint?` · ${notice.recipientHint}`:''}</p>
  {notice?.whatsappStatus==='blocked'&&<p>{({campaign_notice_contact_required:'Cadastre o contato administrativo em Configurações para receber no WhatsApp.',campaign_notice_contact_changed:'Contato alterado. Este aviso permanece no painel; o novo número receberá os próximos avisos.',meta_connection_unavailable:'Conecte o WhatsApp da loja em Configurações.',approved_template_unavailable:'Aguarde a aprovação do modelo de aviso na Meta.',campaign_notice_self_recipient:'Use um contato administrativo diferente do remetente da loja.'} as Record<string,string>)[notice.error??'']??'Revise a conexão e o modelo de aviso em Configurações.'} O aviso continua no painel.</p>}
  </details>}
 </section>;
}
