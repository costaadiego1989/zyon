import {useCallback,useEffect,useLayoutEffect,useRef,useState} from "react";
import type {ProspectConversation,ProspectMessage,ProspectNote,ProspectRealtimeEvent} from "@zyon/shared-types";
import {PlatformApiError} from "../../lib/api.js";
import {ProspectCommandUnresolved,type ProspectingApi} from "../../lib/prospecting-api.js";
import {ProspectingState} from "./ProspectingShell.js";

type Client=Pick<ProspectingApi,"watch"|"command"|"history"|"changes"|"offers"|"notes"|"markRead"|"send"|"ownership"|"addNote">;
type Props={api:Client;conversationId:string;operatorId:string;onSessionExpired:()=>void};
type Destinations=Awaited<ReturnType<Client["offers"]>>;
const authors={ai:"IA da Zyon",prospect:"Contato",system:"Sistema",operator:"Operador"};
const states:Record<ProspectMessage["state"],string>={received:"Recebida",prepared:"Preparada",reserved:"Reservada",submitting:"Em submissão",provider_accepted:"Aceita pelo provedor",delivered:"Entregue",read:"Lida",not_accepted:"Recusada pelo provedor",outcome_unknown:"Resultado desconhecido",cancelled_before_submit:"Cancelada antes do envio"};
const reasons:Record<string,string>={reply_budget_unavailable:"Esta conversa não possui orçamento disponível para a resposta.",cost_unknown:"O custo da resposta ainda não foi confirmado.",budget_conflict:"O orçamento disponível é insuficiente.",suppressed:"O contato está bloqueado para mensagens.",outside_send_window:"A janela de atendimento está encerrada.",sender_unavailable:"O remetente da Zyon está indisponível.",sender_identity_mismatch:"A autorização do remetente mudou.",epoch_conflict:"O controle mudou. Confira o responsável atual.",ownership_conflict:"O controle mudou. Confira o responsável atual.",sales_evidence_conflict:"A fonte ou a oferta mudou antes do envio."};
const when=(v:string|null)=>v?new Intl.DateTimeFormat("pt-BR",{dateStyle:"short",timeStyle:"short"}).format(new Date(v)):"Sem registro";
function ordered(existing:ProspectMessage[],next:ProspectMessage[]){
 return [...new Map([...existing,...next].map(m=>[m.id,m])).values()].sort((a,b)=>a.sequence-b.sequence);
}
function safeLink(m:ProspectMessage,d:Destinations|null){
 if(!d||m.authorType!=="ai"||!m.content||!["provider_accepted","delivered","read"].includes(m.state))return null;
 try{
  const url=new URL(m.content);if(url.protocol!=="https:"||url.username||url.password)return null;
  if(url.href===d.siteUrl)return {url:url.href,label:"Abrir site da Zyon"};
  const token=url.searchParams.getAll("proposal");if(token.length!==1||!/^[\w-]{43}$/.test(token[0]))return null;
  url.searchParams.delete("proposal");
  return d.items.some(o=>o.canonicalUrl===url.href)?{url:m.content,label:"Abrir proposta de cadastro"}:null;
 }catch{return null;}
}
export function ProspectChat(props:Props){return <Thread key={props.conversationId+"."+props.operatorId} {...props}/>;}
function Thread({api,conversationId:id,operatorId,onSessionExpired}:Props){
 const [thread,setThread]=useState<ProspectConversation|null>(null),[messages,setMessages]=useState<ProspectMessage[]>([]),[notes,setNotes]=useState<ProspectNote[]>([]);
 const [cursor,setCursor]=useState<string|null>(null),[noteCursor,setNoteCursor]=useState<string|null>(null);
 const [destinations,setDestinations]=useState<Destinations|null>(null);
 const [state,setState]=useState<"loading"|"ready"|"forbidden"|"error">("loading"),[attempt,setAttempt]=useState(0);
 const [message,setMessage]=useState(""),[note,setNote]=useState(""),[notice,setNotice]=useState(""),[busy,setBusy]=useState(false),[moreBusy,setMoreBusy]=useState(false);
 const receiptKey="zyon.prospect.command."+encodeURIComponent(operatorId)+"."+encodeURIComponent(id);
 function remember(key:string|null){try{if(key)sessionStorage.setItem(receiptKey,key);else sessionStorage.removeItem(receiptKey);}catch{/* Keep the in-memory pending command when storage is unavailable. */}}
 const [pending,setPending]=useState<(()=>Promise<void>)|null>(null);
 const scroll=useRef<HTMLDivElement>(null),anchor=useRef<{id:string;top:number}|null>(null),bottom=useRef(true),revision=useRef(0),syncing=useRef(false);
 const active=useRef<AbortController|null>(null),currentMessages=useRef(messages),callback=useRef(onSessionExpired);
 currentMessages.current=messages;callback.current=onSessionExpired;
 const fail=useCallback((error:unknown)=>{
  if(error instanceof PlatformApiError&&[401,403].includes(error.status)){setState("forbidden");if(error.status===401)callback.current();return;}
  setNotice(error instanceof Error&&reasons[error.message]?reasons[error.message]:"Não foi possível concluir a operação. Atualize a conversa.");
 },[]);
 useEffect(()=>{
  const abort=new AbortController();active.current=abort;setState("loading");setNotice("");
  void Promise.all([api.history(id,{},abort.signal),api.notes(id,undefined,abort.signal),api.offers(abort.signal).catch(()=>null)])
   .then(([page,internal,offers])=>{if(abort.signal.aborted)return;setThread(page.conversation);setMessages(page.messages);setCursor(page.hasMore?page.nextCursor:null);
    setNotes(internal.items);setNoteCursor(internal.nextCursor);setDestinations(offers);revision.current=page.conversation.revision??0;setState("ready");})
   .catch(e=>{if(abort.signal.aborted)return;if(e instanceof PlatformApiError&&[401,403].includes(e.status))fail(e);else setState("error");});
  return ()=>{abort.abort();active.current=null;};
 },[api,id,attempt,fail]);
 const refresh=useCallback(async(force=false)=>{
  const signal=active.current?.signal;if(!signal||signal.aborted||syncing.current)return;syncing.current=true;
  try{
   const events:ProspectRealtimeEvent[]=[];let after=revision.current;
   for(;;){const batch=await api.changes(id,after,100,signal);events.push(...batch.items);const next=Number(batch.nextCursor);if(batch.hasMore&&next<=after)throw Error("invalid_change_cursor");after=next;if(!batch.hasMore)break;}
   if(!events.length&&!force)return;
   const page=await api.history(id,{},signal);const rows=[...page.messages],seen=new Set(rows.map(m=>m.sequence));
   const loaded=currentMessages.current,tail=loaded.at(-1)?.sequence??0;
   if(loaded.length&&page.messages.length&&page.messages[0].sequence>tail+1){
    let boundary=tail;
    while(boundary<page.messages[0].sequence-1){const gap=await api.history(id,{after:boundary,limit:100},signal);if(!gap.messages.length)break;rows.push(...gap.messages);boundary=gap.messages.at(-1)!.sequence;}
   }
   for(const seq of new Set(events.map(e=>e.sequence))){
    if(seq!==null&&!seen.has(seq)&&loaded.some(m=>m.sequence===seq)){const delta=await api.history(id,{after:seq-1,limit:1},signal);rows.push(...delta.messages);}
   }
   if(events.some(e=>e.kind==="note")){const result=await api.notes(id,undefined,signal);if(!signal.aborted)setNotes(prev=>[...new Map([...result.items,...prev].map(n=>[n.id,n])).values()]);}
   if(signal.aborted)return;
   setThread(prev=>prev&&(prev.revision??0)>(page.conversation.revision??0)?prev:page.conversation);setMessages(prev=>ordered(prev,rows));revision.current=after;
  }catch(e){if(!signal.aborted)fail(e);}finally{syncing.current=false;}
 },[api,id,fail]);
 useEffect(()=>{
  if(state!=="ready")return;
  const poll=()=>{if(document.visibilityState!=="hidden")void refresh();};
  const stop=api.watch(id,()=>revision.current,poll);
  const interval=window.setInterval(poll,4000);window.addEventListener("focus",poll);window.addEventListener("online",poll);
  return ()=>{stop();clearInterval(interval);window.removeEventListener("focus",poll);window.removeEventListener("online",poll);};
 },[api,id,state,refresh]);
 useLayoutEffect(()=>{
  const box=scroll.current;if(!box)return;
  if(anchor.current){const row=Array.from(box.querySelectorAll<HTMLElement>("[data-message]")).find(el=>el.dataset.message===anchor.current!.id);if(row)box.scrollTop+=row.getBoundingClientRect().top-anchor.current.top;anchor.current=null;}
  else if(bottom.current)box.scrollTop=box.scrollHeight;
 },[messages]);
 async function earlier(){
  if(!cursor||moreBusy)return;setMoreBusy(true);const signal=active.current?.signal;
  try{const page=await api.history(id,{before:Number(cursor)},signal);if(signal?.aborted)return;
   const first=scroll.current?.querySelector<HTMLElement>("[data-message]");if(first)anchor.current={id:first.dataset.message!,top:first.getBoundingClientRect().top};
   bottom.current=false;setMessages(prev=>ordered(page.messages,prev));setCursor(page.hasMore?page.nextCursor:null);
  }catch(e){if(!signal?.aborted)fail(e);}finally{if(!signal?.aborted)setMoreBusy(false);}
 }
 useEffect(()=>{
  if(state!=="ready")return;
  let key:string|null=null;try{key=sessionStorage.getItem(receiptKey);}catch{return;}
  if(!key)return;
  const commandId=key;
  setNotice("Aguardando confirmação de um comando anterior.");
  setPending(()=>async()=>{
   let found;
   try{found=await api.command(commandId);}catch(e){if(e instanceof PlatformApiError&&[401,403].includes(e.status))throw e;throw new ProspectCommandUnresolved(commandId,"unconfirmed");}
   if(found.state==="failed")throw new PlatformApiError(409,found.errorCode??undefined,found.errorCode??undefined);
   if(found.state!=="completed"||found.clientRequestId!==commandId)throw new ProspectCommandUnresolved(commandId,found.state);
   await refresh(true);
  });
 },[state,api,receiptKey,refresh]);
 async function run(command:()=>Promise<void>,commandId?:string){
  if(busy)return;setBusy(true);setNotice("");if(commandId)remember(commandId);
  try{await command();remember(null);setPending(null);}
  catch(e){if(!active.current)return;
   if(e instanceof ProspectCommandUnresolved){remember(e.clientRequestId);setPending(()=>command);setNotice("Aguardando confirmação do servidor. Consulte o resultado antes de continuar.");}
   else{if(!(e instanceof PlatformApiError&&[401,403].includes(e.status)&&!commandId))remember(null);setPending(null);fail(e);if(e instanceof PlatformApiError&&e.status===409)await refresh(true);}
  }finally{if(active.current)setBusy(false);}
 }
 if(state!=="ready"||!thread)return <ProspectingState state={state==="ready"?"loading":state} retry={state==="error"?()=>setAttempt(x=>x+1):undefined}/>;
 const mine=thread.mode==="human"&&thread.assignedOperatorId===operatorId,locked=busy||!!pending;
 const sendable=mine&&!!thread.serviceWindowEndsAt&&Date.parse(thread.serviceWindowEndsAt)>Date.now();
 const own=()=>{const body={clientRequestId:crypto.randomUUID(),action:mine?"release" as const:"assume" as const,expectedEpoch:thread.controlEpoch};
  void run(async()=>{const next=await api.ownership(id,body);setThread(next);},body.clientRequestId);};
 const send=()=>{const body={clientRequestId:crypto.randomUUID(),content:message.trim(),expectedEpoch:thread.controlEpoch};void run(async()=>{
  const saved=await api.send(id,body);setMessages(prev=>ordered(prev,[saved]));setMessage("");},body.clientRequestId);};
 const saveNote=()=>{const body={clientRequestId:crypto.randomUUID(),content:note.trim()};void run(async()=>{const saved=await api.addNote(id,body);setNotes(prev=>[saved,...prev.filter(n=>n.id!==saved.id)]);setNote("");},body.clientRequestId);};
 const markRead=()=>{const body={clientRequestId:crypto.randomUUID(),sequence:thread.lastSequence};void run(async()=>{
  const saved=await api.markRead(id,body);setThread(prev=>prev?{...prev,readSequence:saved.readSequence,unreadCount:prev.lastSequence===saved.readSequence?0:prev.unreadCount}:prev);},body.clientRequestId);};
 return <section className="prospecting-chat" aria-label="Conversa com o contato">
  <header><div><h2>Conversa</h2><p>{mine?"Sob seu atendimento":thread.mode==="ai"?"Atendimento pela IA":"Atendimento humano · "+(thread.assignedOperatorId??"Sem responsável")}</p></div>
   <button className="button" disabled={locked} onClick={own}>{mine?"Devolver para a IA":"Assumir atendimento"}</button></header>
  <dl><div><dt>Última resposta do contato</dt><dd>{thread.lastInboundPreview??"Sem resposta registrada"} · {when(thread.lastInboundAt)}</dd></div>
   <div><dt>Janela de atendimento</dt><dd>{thread.serviceWindowEndsAt?(Date.parse(thread.serviceWindowEndsAt)>Date.now()?"Aberta até ":"Encerrada em ")+when(thread.serviceWindowEndsAt):"Sem janela confirmada"}</dd></div></dl>
  {!!thread.ambiguousBindings.length&&<p role="status">Contato compartilhado. A empresa desta conversa está indefinida.</p>}
  <div className="prospecting-chat-tools"><button className="button" onClick={()=>void refresh(true)}>Atualizar conversa</button>
   {thread.unreadCount>0&&<button className="button" disabled={locked} onClick={markRead}>Marcar como lida</button>}
   {cursor&&<button className="button" disabled={moreBusy} onClick={()=>void earlier()}>Carregar mensagens anteriores</button>}</div>
  <div className="prospecting-transcript" aria-label="Histórico de mensagens" tabIndex={0} ref={scroll} onScroll={e=>{const box=e.currentTarget;bottom.current=box.scrollHeight-box.clientHeight-box.scrollTop<24;}}>
   {messages.length?<ol>{messages.map(m=>{const link=safeLink(m,destinations);return <li key={m.id} data-message={m.id}><div><strong>{authors[m.authorType]}{m.authorType==="operator"&&m.authorId?" · "+(m.authorId===operatorId?"Você":m.authorId):""}</strong>
    <time dateTime={m.providerOccurredAt??m.createdAt}>{when(m.providerOccurredAt??m.createdAt)}</time></div><p>{link?<a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>:m.content??"Conteúdo descartado"}</p><small>{states[m.state]}</small></li>;})}</ol>:<p>Nenhuma mensagem nesta conversa.</p>}
  </div>
  <form onSubmit={e=>{e.preventDefault();if(sendable&&!locked&&message.trim())send();}}><label>Mensagem ao contato<textarea aria-label="Mensagem ao contato" value={message} disabled={!sendable||locked} onChange={e=>setMessage(e.target.value)} maxLength={4000}/></label>
   <button className="button button--primary" disabled={!sendable||locked||!message.trim()}>Enviar mensagem</button></form>
  {notice&&<p role="status">{notice}</p>}{pending&&<button className="button" disabled={busy} onClick={()=>void run(pending)}>Consultar resultado</button>}
  <section className="prospecting-internal" aria-label="Notas internas"><h3>Notas internas</h3><p>Visíveis apenas para a equipe.</p>
   {notes.map(n=><p key={n.id}><strong>{n.operatorId===operatorId?"Você":n.operatorId}</strong> · <time dateTime={n.createdAt}>{when(n.createdAt)}</time><br/>{n.content??"Conteúdo descartado"}</p>)}
   {noteCursor&&<button className="button" onClick={()=>void api.notes(id,noteCursor).then(p=>{setNotes(prev=>[...new Map([...prev,...p.items].map(n=>[n.id,n])).values()]);setNoteCursor(p.nextCursor);}).catch(fail)}>Carregar notas anteriores</button>}
   <form onSubmit={e=>{e.preventDefault();if(!locked&&note.trim())saveNote();}}><label>Nota interna<textarea aria-label="Nota interna" value={note} disabled={locked} onChange={e=>setNote(e.target.value)} maxLength={4000}/></label>
    <button className="button" disabled={locked||!note.trim()}>Salvar nota</button></form></section>
 </section>;
}
