import {useEffect,useRef,useState} from 'react';
import type {MetaAdsMetrics} from '@zyon/shared-types';
import type {MetaAdsAgentApi} from '../../api/endpoints/meta-ads-agent.js';
import {showToast} from '../../components/Toast.js';

interface Row {metrics?:MetaAdsMetrics;loading:boolean;error?:string;}
/** At most two read-only requests for visible rows. Context changes discard late results. */
export function useExistingMetrics(api:MetaAdsAgentApi,ids:string[],scope:string,since:string,until:string,enabled:boolean){
 const key=JSON.stringify([scope,since,until,enabled,ids]);
 const [state,setState]=useState<{key:string;rows:Record<string,Row>}>({key:'',rows:{}});
 const enqueue=useRef<((id:string)=>void)|null>(null);
 useEffect(()=>{
  let live=true,workers=0,announced=false;const queue:Array<{id:string;retry:boolean}>=[],pending=new Set<string>();
  const validPeriod=/^\d{4}-\d{2}-\d{2}$/.test(since)&&/^\d{4}-\d{2}-\d{2}$/.test(until)&&since<=until;
  setState({key,rows:{}});
  function set(id:string,row:Row){if(live)setState(old=>old.key===key?{key,rows:{...old.rows,[id]:row}}:old);}
  async function worker(){
   workers++;
   try{while(live&&queue.length){const next=queue.shift()!;
    try{const metrics=await api.existingMetrics(next.id,since,until);if(!live)return;
     if(metrics.campaignId!==`existing-${next.id}`||metrics.since!==since||metrics.until!==until)throw Error('metric_context_mismatch');
     set(next.id,{metrics,loading:false});if(next.retry)showToast('success','Resultados atualizados.');
    }catch{if(!live)return;set(next.id,{loading:false,error:'Não foi possível consultar os resultados.'});if(next.retry||!announced){announced=true;showToast('error','Não foi possível consultar alguns resultados. Tente novamente.');}}
    finally{pending.delete(next.id);}
   }}finally{workers--;}
  }
  function request(id:string,retry:boolean){if(!live||!enabled||!scope||!validPeriod||!ids.includes(id)||pending.has(id))return;pending.add(id);queue.push({id,retry});set(id,{loading:true});if(workers<2)void worker();}
  enqueue.current=id=>request(id,true);
  if(enabled&&scope&&validPeriod)for(const id of ids)request(id,false);
  return()=>{live=false;queue.length=0;enqueue.current=null;};
 },[api,key]);
 return {rows:state.key===key?state.rows:{},retry:(id:string)=>enqueue.current?.(id)};
}
