import {useEffect,useRef,useState} from 'react';
import type {MetaAdsPreparationLimitsView} from '@zyon/shared-types';
import type {MetaAdsAgentApi} from '../../api/endpoints/meta-ads-agent.js';
import {Button} from '../../components/Button.js';
import {showToast} from '../../components/Toast.js';
import {errorMessage} from './presentation.js';
import './campaign-workspace.css';
interface Props {merchantId:string;api:Pick<MetaAdsAgentApi,'preparationLimits'|'savePreparationLimits'>;onFeedback?(type:'success'|'error',message:string):void}
const blockers:Record<string,string>={preparation_disabled:'Novos preparos estão interrompidos.',preparation_daily_limit:'O limite de novas propostas de hoje foi atingido.',preparation_pending_limit:'A fila está no limite. Revise uma proposta antes de preparar outra.',campaign_capacity_exceeded:'O limite de campanhas do plano foi atingido.',meta_timezone_unavailable:'Conecte a conta de anúncios para conferir o uso do dia.',addon_not_entitled:'Confira o plano da loja para usar o motor.'};
export function AutomaticPreparationSettings(props:Props){return <Settings key={props.merchantId} {...props}/>;}
function Settings({api,onFeedback=showToast}:Props){
 const [view,setView]=useState<MetaAdsPreparationLimitsView|null>(null),[daily,setDaily]=useState(''),[pending,setPending]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[reload,setReload]=useState(0);const life=useRef<AbortController|null>(null),lock=useRef(false);
 useEffect(()=>{const controller=new AbortController();life.current=controller;setLoading(true);void api.preparationLimits(controller.signal).then(next=>{if(controller.signal.aborted)return;setView(next);setDaily(String(next.limits.dailyNewProposals));setPending(String(next.limits.maximumPendingProposals));setError('');}).catch(()=>{if(!controller.signal.aborted)setError('Não foi possível consultar os limites do motor. Tente novamente.');}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();},[api,reload]);
 async function save(){if(!view||lock.current)return;const cap=view.planCampaignCapacity;if(!/^\d+$/.test(daily)||!/^\d+$/.test(pending)||![Number(daily),Number(pending)].every(v=>Number.isSafeInteger(v)&&v>=0&&v<=cap)){setError(`Use números inteiros de 0 a ${cap}.`);return;}
  lock.current=true;setBusy(true);setError('');const controller=life.current;
  try{const next=await api.savePreparationLimits({dailyNewProposals:Number(daily),maximumPendingProposals:Number(pending),expectedVersion:view.limits.version});if(controller?.signal.aborted)return;setView(next);setDaily(String(next.limits.dailyNewProposals));setPending(String(next.limits.maximumPendingProposals));onFeedback('success','Limites do motor salvos.');}
  catch(cause){if(!controller?.signal.aborted){const message=errorMessage(cause);setError(message);onFeedback('error',message);}}
  finally{lock.current=false;if(!controller?.signal.aborted)setBusy(false);}
 }
 return <section className="ads-preparation-settings dashboard-ui" aria-labelledby="ads-preparation-settings-heading"><h3 id="ads-preparation-settings-heading">Novas campanhas pelo motor</h3><p>A IA escolhe produtos autorizados e prepara anúncios para sua revisão. Toda campanha nova precisa da sua aprovação antes de ir ao ar.</p>
  {loading&&!view?<div role="status" className="ads-workspace__skeleton">Carregando limites do motor…</div>:null}
  {view?<><div className="ads-preparation-settings__usage"><span>Hoje: {view.usedToday} de {view.effectiveDailyLimit}</span><span>Aguardando aprovação: {view.pending} de {view.effectivePendingLimit}</span></div><form noValidate onSubmit={event=>{event.preventDefault();void save();}}><div className="ads-preparation-settings__fields"><label className="form-field">Novas propostas por dia<input type="number" aria-label="Novas propostas por dia" inputMode="numeric" min={0} max={view.planCampaignCapacity} step={1} value={daily} disabled={busy||loading} onChange={event=>setDaily(event.target.value)}/></label><label className="form-field">Propostas aguardando aprovação<input type="number" aria-label="Propostas aguardando aprovação" inputMode="numeric" min={0} max={view.planCampaignCapacity} step={1} value={pending} disabled={busy||loading} onChange={event=>setPending(event.target.value)}/></label></div><small>Zero interrompe novos preparos. A fila atual será mantida. Estes limites não alteram a verba nem compram imagens extras.</small>{view.blockedReason?<p className="ads-preparation-settings__blocker" role="status">{blockers[view.blockedReason]??'O preparo precisa de atenção. Confira a campanha e a conexão.'}</p>:null}<div className="ads-preparation-settings__actions"><Button type="submit" disabled={busy||loading} loading={busy}>Salvar limites</Button>{error?<Button variant="outline" disabled={busy||loading} onClick={()=>setReload(n=>n+1)}>Conferir limites salvos</Button>:null}</div></form></>:null}
  {error?<p className="form-field-error" role="alert">{error}</p>:null}
  {!view&&!loading?<Button variant="outline" onClick={()=>setReload(n=>n+1)}>Tentar novamente</Button>:null}
 </section>;
}
