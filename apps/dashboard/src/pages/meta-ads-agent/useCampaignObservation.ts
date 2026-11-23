import {useCallback,useEffect,useRef,useState} from 'react';
import type {MetaAdsCampaignWorkspaceRow} from '@zyon/shared-types';
import type {MetaAdsAgentApi} from '../../api/endpoints/meta-ads-agent.js';
import {errorMessage} from './presentation.js';

export function useCampaignObservation({row,api,merchantId,accountId,epoch,entitled,period,revision=0}:{row:MetaAdsCampaignWorkspaceRow;api:MetaAdsAgentApi;merchantId:string;accountId:string|null;epoch:number;entitled:boolean;period?:{since:string;until:string};revision?:number}){
 const c=row.campaign,enabled=!!period&&entitled&&c.createdByAgent&&c.managed&&c.lifecycle?.state!=='archived'&&!!c.remoteCampaignId&&!!c.remoteAdSetId&&c.remoteAdIds.length>0&&typeof api.refreshCampaign==='function';
 const key=JSON.stringify([merchantId,c.id,accountId,epoch,c.remoteCampaignId,c.remoteAdSetId,c.remoteAdIds,c.updatedAt,c.status,c.draft,c.managed,c.lifecycle,period?.since,period?.until,revision]),current=useRef(key);current.current=key;
 const [result,setResult]=useState<{key:string;row:MetaAdsCampaignWorkspaceRow}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const request=useRef<AbortController|null>(null),sequence=useRef(0),alive=useRef(true);
 const refresh=useCallback(async()=>{
  if(!enabled||!period)return row;
  request.current?.abort();const controller=new AbortController();request.current=controller;const sequenceId=++sequence.current;
  setBusy(true);setError('');
  try{const value=await api.refreshCampaign(c.id,period,controller.signal);if(alive.current&&!controller.signal.aborted&&current.current===key&&sequence.current===sequenceId)setResult({key,row:value});return value;}
  catch(cause){if(alive.current&&!controller.signal.aborted&&current.current===key&&sequence.current===sequenceId)setError(errorMessage(cause));throw cause;}
  finally{if(alive.current&&current.current===key&&sequence.current===sequenceId)setBusy(false);}
 },[api,key,enabled]);
 useEffect(()=>{alive.current=true;if(enabled)void refresh().catch(()=>{});return()=>{alive.current=false;sequence.current++;request.current?.abort();};},[refresh,enabled]);
 const observed=result?.key===key&&result.row.campaign.id===c.id&&Date.parse(result.row.observation?.checkedAt??'')>=Date.parse(c.updatedAt)?result.row:row;
 return{row:observed,enabled,busy,error,refresh};
}
