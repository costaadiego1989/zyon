import {useCallback,useEffect,useRef,useState} from "react";
import type {PlatformSenderSignupState} from "@zyon/shared-types";
import {Button,dateTime,ReadState,useAction,useResource,type PageProps} from "./screen-controls.js";
import {blockers} from "./CampaignComposer.js";
import {platformSignup,type SignupSdk,type SignupAssets} from "./platform-signup.js";
export function ProspectingChannelPage(props:PageProps&{mode:"controlled"|"live"|"disabled";controlledSdk?:SignupSdk}){
 const {api,mode,controlledSdk,onSessionExpired}=props;const load=useCallback((s:AbortSignal)=>api.sender(s),[api]);const channel=useResource(load,onSessionExpired);const action=useAction(props,"sender",channel.reload);
 const [state,setState]=useState<PlatformSenderSignupState|null>(null),[assets,setAssets]=useState<SignupAssets|null>(null),[choice,setChoice]=useState(""),[waiting,setWaiting]=useState(false),[notice,setNotice]=useState("");
 const lifetime=useRef<AbortController|null>(null);
 useEffect(()=>{lifetime.current=new AbortController();return ()=>lifetime.current?.abort();},[]);
 useEffect(()=>{if(!state)return;const timer=window.setTimeout(()=>{setState(null);setAssets(null);setNotice("A autorização expirou. Inicie uma nova conexão.");},Math.max(0,Date.parse(state.expiresAt)-Date.now()));return ()=>clearTimeout(timer);},[state]);
 const sdk=mode==="controlled"?controlledSdk:platformSignup;
 async function open(){if(!sdk||!state||!lifetime.current)return;setWaiting(true);const signal=lifetime.current.signal;
  try{const result=await sdk.open(state,signal);if(!signal.aborted&&Date.parse(state.expiresAt)>Date.now()){setAssets(result);setChoice(result.messagingAccountIds.length===1?result.messagingAccountIds[0]:"");}}
  catch{if(!signal.aborted){setNotice("Autorização interrompida. Confira a janela da Meta e tente novamente.");setState(null);}}finally{if(!signal.aborted)setWaiting(false);}
 }
 const value=channel.data,binding=value?.binding;
 return <section className="prospecting-page"><header><h2>Canal da Zyon</h2><p>Conexão oficial do WhatsApp usada pela equipe de prospecção.</p></header>{mode==="controlled"&&<p>Ambiente controlado · autorização e envio locais.</p>}
 {action.feedback}{notice&&<p role="status">{notice}</p>}{!value?<ReadState {...channel}/>:<><dl>{Object.entries({"Número próprio":binding?.displayPhoneNumber??"Sem vínculo","Conta de mensagens (WABA)":binding?.wabaId??"Sem vínculo","ID do número":binding?.phoneNumberId??"Sem vínculo","Versão do vínculo":binding?.version??"Sem vínculo","Conectado em":dateTime(binding?.connectedAt),"Saúde observada":({ready:"Disponível",blocked:"Impedida",unknown:"Desconhecida"})[value.status],"Atualização":dateTime(value.updatedAt),"Portfólio Meta (24h móveis)":(value.portfolioUsed??"Desconhecido")+" / "+(value.portfolioLimit??value.portfolioTier??"Desconhecido")}).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
 <section><h3>Pré-requisitos de envio</h3>{value.blockers.length?value.blockers.map(b=><p key={b}>{blockers[b]}</p>):<p>O canal não informou impedimentos.</p>}<p>O destinatário precisa de opt-in e o template precisa estar aprovado para este vínculo.</p>
 {value.entities?.map(e=><p key={e.type+e.id}>{e.type} · {e.id} · {e.status}{e.errorCodes.length?" · "+e.errorCodes.join(", "):""}</p>)}</section>
 <div className="prospecting-actions"><Button onClick={channel.reload}>Atualizar canal</Button>
 {!state&&<Button primary disabled={!sdk||action.disabled} onClick={()=>void action.run(async key=>{setNotice("");const next=await api.signupState({clientRequestId:key});await sdk!.prepare(next);if(!lifetime.current?.signal.aborted)setState(next);return "Autorização preparada.";})}>Conectar número Zyon</Button>}
 {state&&!assets&&<Button primary disabled={waiting||action.disabled} onClick={open}>Abrir autorização</Button>}</div>
 {assets&&state&&<form className="prospecting-actions" onSubmit={e=>{e.preventDefault();void action.run(async key=>{try{const confirmed=await api.connect({...assets,wabaId:choice,state:state.state,clientRequestId:key});channel.reload();return "Vínculo confirmado · "+confirmed.displayPhoneNumber;}finally{setState(null);setAssets(null);setChoice("");}});}}>
 <label>Conta de mensagens autorizada<select required value={choice} onChange={e=>setChoice(e.target.value)}><option value="">Selecionar conta</option>{assets.messagingAccountIds.map(id=><option key={id}>{id}</option>)}</select></label><Button type="submit" disabled={!choice||action.disabled} primary>Confirmar vínculo</Button></form>}
 <section><h3>Templates observados</h3>{!value.templates.length&&<p>Nenhum template disponível para este número.</p>}{value.templates.map(t=><div className="prospecting-row" key={t.id}><div><strong>{t.name}</strong><small>{t.language} · {t.category} · {t.status}</small></div><p>{t.previewText??"Sem texto disponível"}{t.requiresParameters&&" · Exige parâmetros ou mídia"}</p></div>)}</section></>}</section>;
}
