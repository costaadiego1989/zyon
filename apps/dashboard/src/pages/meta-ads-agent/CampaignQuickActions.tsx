import {useEffect,useRef,useState} from 'react';
import {Archive,Pause,RefreshCw,Trash2} from 'lucide-react';
import type {MetaAdsCampaignWorkspaceRow} from '@zyon/shared-types';
import type {MetaAdsAgentApi} from '../../api/endpoints/meta-ads-agent.js';
import {DashboardHttpError} from '../../api/http/error.js';
import {ConfirmDialog} from '../../components/ConfirmDialog.js';
import {Button} from '../../components/Button.js';
import {errorMessage} from './presentation.js';
type Action='pause'|'delete'|'archive';
interface Review {action:Action;campaignId:string;name:string;version:number;key:string}
export interface CampaignQuickActionsProps {row:MetaAdsCampaignWorkspaceRow;api:Pick<MetaAdsAgentApi,'propose'|'approve'|'execute'|'deleteDraft'|'archiveCampaign'>;onChanged():Promise<void>|void;onVerify?():Promise<void>|void;onFeedback(type:'success'|'pending'|'error',message:string):void}
function actionError(error:unknown){let code='';if(error instanceof DashboardHttpError){try{code=JSON.parse(error.responseBody).code;}catch{/* Shared generic message. */}}return({campaign_operation_pending:'Há uma preparação ou alteração em andamento. Aguarde terminar antes de excluir ou arquivar.',campaign_version_conflict:'A campanha mudou. Atualize os dados e confira novamente.',campaign_pause_required:'Pause a campanha antes de arquivar.',campaign_remote_state_unavailable:'Confira a situação na Meta antes de arquivar.',campaign_has_remote_objects:'Esta campanha já foi preparada na Meta. Use Arquivar depois de pausá-la.'} as Record<string,string>)[code]??errorMessage(error);}
export function CampaignQuickActions({row,api,onChanged,onVerify,onFeedback}:CampaignQuickActionsProps){
 const [review,setReview]=useState<Review|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');const lock=useRef(false),alive=useRef(true);
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const open=(action:Action)=>{setError('');setNotice('');setReview({action,campaignId:row.campaign.id,name:row.campaign.draft.name,version:row.campaign.lifecycle?.version??0,key:crypto.randomUUID()});};
 async function confirm(){if(!review||lock.current)return;lock.current=true;setBusy(true);setError('');try{
  let type:'success'|'pending'='success',message='';
  if(review.action==='pause'){
   const proposal=await api.propose(review.campaignId,{kind:'pause',after:{},reasoning:'Pausa solicitada pelo administrador no painel da loja.',idempotencyKey:review.key});
   await api.approve(proposal.id,proposal.digest);const result=await api.execute(proposal.id);
   if(result.status==='remote_paused'){message='Campanha pausada.';}
   else if(result.status==='failed')throw new Error('pause_failed');
   else{type='pending';message='A pausa ainda não foi confirmada pela Meta.';}
  }else{const input={expectedVersion:review.version,idempotencyKey:review.key};if(review.action==='delete'){await api.deleteDraft(review.campaignId,input);message='Rascunho excluído.';}else{await api.archiveCampaign(review.campaignId,input);message='Campanha arquivada. O histórico foi preservado.';}}
  if(!alive.current)return;setReview(null);setNotice(message);onFeedback(type,message);await onChanged();
 }catch(cause){if(alive.current){const message=actionError(cause);setError(message);onFeedback('error',message);}}finally{lock.current=false;if(alive.current)setBusy(false);}}
 const writable=row.campaign.createdByAgent&&row.campaign.managed&&row.campaign.lifecycle?.state!=='archived';
 if(!writable)return null;
 const title=review?.action==='pause'?'Pausar campanha?':review?.action==='delete'?'Excluir rascunho?':'Arquivar campanha?';
 const confirmLabel=review?.action==='pause'?'Confirmar pausa':review?.action==='delete'?'Excluir rascunho':'Arquivar campanha';
 const description=review?.action==='pause'?`Você vai interromper a veiculação de “${review.name}”. O histórico de resultados será mantido.`:review?.action==='delete'?`O rascunho “${review.name}” será excluído e não será publicado. O preparo pendente será cancelado.`:`“${review?.name}” sairá da lista principal e da gestão automática. Você poderá consultar o histórico de gastos e vendas em Arquivadas.`;
 return <div className="ads-quick-actions">
  {row.actions.pause?<Button variant="outline" size="sm" disabled={busy} onClick={()=>open('pause')}><Pause size={14} aria-hidden="true"/>Pausar</Button>:null}
  {row.actions.deleteDraft?<Button variant="ghost" size="sm" disabled={busy} onClick={()=>open('delete')}><Trash2 size={14} aria-hidden="true"/>Excluir rascunho</Button>:null}
  {row.actions.archive?<Button variant="ghost" size="sm" disabled={busy} onClick={()=>open('archive')}><Archive size={14} aria-hidden="true"/>Arquivar</Button>:null}
  {row.actions.verifyRemote&&onVerify?<Button variant="outline" size="sm" disabled={busy} onClick={()=>void onVerify()}><RefreshCw size={14} aria-hidden="true"/>Verificar situação</Button>:null}
  {notice?<p className="ads-quick-actions__notice" role="status">{notice}</p>:null}
  <ConfirmDialog open={!!review} title={title} description={description} confirmLabel={confirmLabel} variant={review?.action==='delete'?'danger':'default'} onConfirm={()=>void confirm()} onCancel={()=>{if(!busy)setReview(null);}} busy={busy} error={error}/>
 </div>;
}
