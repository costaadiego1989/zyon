import React,{useState} from "react";
import {Button} from "../components/Button.js";
const storageKey="zyon_prospect_proposal";
export function readProspectProposal():string|null{
 const url=new URL(window.location.href),raw=url.searchParams.get("proposal");
 try{
  if(raw!==null){
   url.searchParams.delete("proposal");window.history.replaceState(window.history.state,"",url.href);
   sessionStorage.removeItem(storageKey);
   if(!/^[A-Za-z0-9_-]{43}$/.test(raw))return null;
   sessionStorage.setItem(storageKey,raw);return raw;
  }
  const saved=sessionStorage.getItem(storageKey);return saved&&/^[A-Za-z0-9_-]{43}$/.test(saved)?saved:null;
 }catch{return raw && /^[A-Za-z0-9_-]{43}$/.test(raw)?raw:null;}
}
export function clearProspectProposal(){try{sessionStorage.removeItem(storageKey);}catch{/* Storage can be disabled. */}}
type Next="manage_subscription"|"select_plan";
export function ProspectProposalBinding({token,name,bind,done}:{token:string;name:string;bind:(token:string)=>Promise<{next:Next}>;done:(next:Next|null)=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(false);
 async function confirm(){
  if(busy)return;setBusy(true);setError(false);
  try{const result=await bind(token);done(result.next);}
  catch{setError(true);}finally{setBusy(false);}
 }
 return <main className="signup-plans"><section><h1>Vincular proposta à conta</h1><p>Deseja vincular a proposta da Zyon à conta {name}?</p>
 {error&&<p role="alert">Não foi possível vincular a proposta. Confira se ela continua válida para esta conta.</p>}
 <Button disabled={busy} onClick={()=>void confirm()}>{busy?"Vinculando…":"Vincular proposta"}</Button>
 <Button variant="outline" disabled={busy} onClick={()=>done(null)}>Continuar sem vincular</Button></section></main>;
}
