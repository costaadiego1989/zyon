import {useEffect,useRef,useState} from 'react';
import type {MetaAdsCampaignLaunchReview} from '@zyon/shared-types';
import type {CampaignApprovalApi,CampaignPreparationView} from './api.js';
import {LaunchReview} from './LaunchReview.js';
import {errorMessage} from './presentation.js';
interface Props{merchantId:string;campaignId:string;proposalId?:string;api:CampaignApprovalApi;entitled:boolean;pollMs:number;timezone?:string;onUpdated:()=>void|Promise<void>;onReconcile?:(id:string)=>Promise<unknown>;}
const states={queued:'Preparação na fila',preparing:'Preparando campanha',creative_pending:'Criando e verificando imagens',review_ready:'Pronta para aprovação',blocked:'Preparação pendente',unknown:'Resultado da preparação desconhecido',superseded:'Planejamento atualizado'};
const blockers:Record<string,string>={campaign_preparation_unavailable:'Ative o motor de IA para preparar a campanha.',image_credits_insufficient:'Créditos de imagens insuficientes. Nenhum extra será comprado automaticamente.',meta_connection_required:'Conecte sua conta Meta em Configurações.',campaign_budget_required:'Informe o orçamento na conversa.',campaign_dates_invalid:'Revise as datas na conversa.',campaign_products_required:'Escolha os produtos na conversa.'};
export function CampaignPreparationPanel(props:Props){return <Preparation key={`${props.merchantId}:${props.campaignId}:${props.proposalId??''}`} {...props}/>;}
function Preparation({merchantId,campaignId,proposalId,api,entitled,pollMs,timezone,onUpdated,onReconcile}:Props){
 const [state,setState]=useState<CampaignPreparationView|null>(null),[review,setReview]=useState<MetaAdsCampaignLaunchReview|null>(null),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[count,setCount]=useState(1);
 const life=useRef<AbortController|null>(null),lock=useRef(false),timer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),read=useRef<()=>Promise<void>>(async()=>{}),updated=useRef(onUpdated);updated.current=onUpdated;
 const job=state?.preparations[0];
 useEffect(()=>{
  const controller=new AbortController();life.current=controller;
  const load=async()=>{
   if(lock.current||controller.signal.aborted)return;lock.current=true;
   try{
    const next=await api.preparation(campaignId,controller.signal);if(controller.signal.aborted)return;
    next.preparations.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)||b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));setState(next);
    const latest=next.preparations[0],id=proposalId??latest?.proposalId;
    let current:MetaAdsCampaignLaunchReview|null=null;
    if(id){current=await api.review(campaignId,id,controller.signal);if(controller.signal.aborted)return;setReview(current);}else setReview(null);
    setError('');
    const pending=latest&&['queued','preparing','creative_pending'].includes(latest.status)||current?.execution&&['reserved','sending','remote_draft','remote_paused','publishing'].includes(current.execution.status)||current?.proposal.status==='approved'&&!current.execution;
    if(pending&&!controller.signal.aborted)timer.current=setTimeout(()=>void load(),pollMs);
   }catch(e){if(!controller.signal.aborted)setError(errorMessage(e));}
   finally{lock.current=false;if(!controller.signal.aborted)setLoading(false);}
  };read.current=load;void load();
  return()=>{controller.abort();clearTimeout(timer.current);};
 },[api,campaignId,proposalId,pollMs]);
 async function prepare(){
  if(lock.current||!state||!entitled||job?.status==='unknown')return;lock.current=true;setBusy(true);setError('');
  try{const next=await api.prepare(campaignId,{campaignDigest:state.campaignDigest,imageCount:job?.requestedImages??count},life.current?.signal);if(!life.current?.signal.aborted){setState({...state,preparations:[next,...state.preparations.filter(j=>j.id!==next.id)]});lock.current=false;await read.current();void updated.current();}}
  catch(e){if(!life.current?.signal.aborted)setError(errorMessage(e));}
  finally{lock.current=false;if(!life.current?.signal.aborted)setBusy(false);}
 }
 const notice=review?.notice;
 return <section aria-label="Preparo e aprovação" className="mga-panel">
  {!review&&<><h2>Preparo da campanha</h2>{loading?<p role="status">Consultando preparo…</p>:<><p role="status">{job?states[job.status]:'Rascunho salvo. Prepare os criativos para revisão.'}</p>{job?.missing.map(code=><p key={code}>{blockers[code]??'Revise a conexão e os dados da campanha em Configurações ou na conversa.'}</p>)}{job?.status==='unknown'&&<p>Consulte o estado antes de solicitar novamente. Nenhum envio será repetido automaticamente.</p>}
  {!job&&<label>Imagens para preparar<select aria-label="Imagens para preparar" value={count} onChange={event=>setCount(Number(event.target.value))}>{Array.from({length:10},(_,i)=><option key={i+1}>{i+1}</option>)}</select></label>}
  {(!job||['blocked','superseded'].includes(job.status))&&<button type="button" disabled={busy||!state||!entitled||!!error} onClick={()=>void prepare()}>{job?'Retomar preparo':'Preparar para revisão'}</button>}
  <small>Usa os créditos de imagens disponíveis. A publicação aguarda sua aprovação.</small></>}</>}
  {error&&<p role="alert">{error}</p>}
  <button type="button" className="mga-secondary" disabled={loading||busy} onClick={()=>{clearTimeout(timer.current);void read.current();}}>Atualizar preparo</button>
  {review&&<LaunchReview merchantId={merchantId} value={review} api={api} timezone={timezone} onReconcile={onReconcile} onUpdated={next=>{setReview(next);clearTimeout(timer.current);void read.current();void updated.current();}}/>}
  {notice&&<p role="status">{notice.reviewState==='approved'?'Campanha aprovada':notice.reviewState==='superseded'?'Aviso de versão anterior':'Aviso no painel'} · WhatsApp: {({queued:'na fila',blocked:'indisponível; o aviso continua no painel',sending:'envio em processamento',accepted:'aceito pela Meta, entrega ainda não confirmada',delivered:'entregue',failed:'falha confirmada',unknown:'resultado desconhecido; sem repetição automática'})[notice.whatsappStatus]}{notice.recipientHint?` · ${notice.recipientHint}`:''}</p>}
 </section>;
}
