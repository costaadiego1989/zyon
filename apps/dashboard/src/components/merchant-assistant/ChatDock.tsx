import { useCallback, useEffect, useLayoutEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { AssistantContextDescriptor, AssistantTurn } from '@zyon/shared-types';
import './chat-dock.css';
import { ArrowUp, ChevronDown, MessageSquare, X } from 'lucide-react';
import {ZyonAgentOrb} from './ZyonAgentOrb.js';

export interface ChatDockProps {
  context: AssistantContextDescriptor; turns: AssistantTurn[]; loading?: boolean; busy?: boolean; disabled?: boolean;
  error?: string; empty?: ReactNode; headerExtra?: ReactNode;
  onSend: (message: string) => Promise<void>; onRetry?: () => void | Promise<void>;
  renderTurnDetails?: (turn: AssistantTurn) => ReactNode;
  older?: ReactNode;
  expanded?: boolean; onExpandedChange?: (expanded:boolean)=>void;
  presentation?:'inline'|'floating'; pageKey?:string; hints?:readonly string[];
}
export function ChatDock({context,turns,loading,busy,disabled=false,error,empty,headerExtra,onSend,onRetry,renderTurnDetails,older,expanded,onExpandedChange,presentation='inline',pageKey=context.id,hints=[]}: ChatDockProps) {
  const floating=presentation==='floating';
  const [localOpen,setLocalOpen]=useState(()=>!floating&&(typeof matchMedia==='undefined'||!matchMedia('(max-width: 900px)').matches));
  const open=expanded??localOpen;
  const [hintIndex,setHintIndex]=useState(-1),[hintDismissed,setHintDismissed]=useState(false);
  useEffect(()=>{setHintIndex(-1);setHintDismissed(false);if(!floating||open||!hints.length)return;const timer=setInterval(()=>{if(document.visibilityState!=='hidden')setHintIndex(previous=>(previous+1)%hints.length);},10000);return()=>clearInterval(timer);},[floating,open,pageKey,hints]);
  const [message,setMessage]=useState(''); const [sending,setSending]=useState(false); const [sendError,setSendError]=useState('');
  const lock=useRef(false), focus=useRef<'composer'|'trigger'|null>(null); const composer=useRef<HTMLTextAreaElement>(null), trigger=useRef<HTMLButtonElement>(null); const id=useId();
  const dock=useRef<HTMLElement>(null);
  const history=useRef<HTMLDivElement>(null),messages=useRef<HTMLDivElement>(null),following=useRef(true),followRequested=useRef(false),previousHeight=useRef(0);
  const followEnd=useCallback(()=>{const el=history.current;if(!el)return;const nearEnd=el.scrollTop+el.clientHeight>=Math.min(previousHeight.current,el.scrollHeight)-32;if(followRequested.current||following.current&&nearEnd){el.scrollTop=el.scrollHeight;following.current=true;followRequested.current=false;}else following.current=false;previousHeight.current=el.scrollHeight;},[]);
  useLayoutEffect(followEnd,[turns,loading,followEnd]);
  useEffect(()=>{if(typeof ResizeObserver==='undefined'||!messages.current)return;let frame:number|undefined;const observer=new ResizeObserver(()=>{if(frame===undefined)frame=window.requestAnimationFrame(()=>{frame=undefined;followEnd();});});observer.observe(messages.current);return()=>{observer.disconnect();if(frame!==undefined)window.cancelAnimationFrame(frame);};},[followEnd]);
  useLayoutEffect(()=>{
    const element=dock.current;if(!open||!element||floating)return;
    let frame:number|undefined;
    const measure=()=>{const height=`${Math.max(240,window.innerHeight-Math.max(20,element.getBoundingClientRect().top)-20)}px`;if(element.style.getPropertyValue('--chat-dock-height')!==height)element.style.setProperty('--chat-dock-height',height);};
    const schedule=()=>{if(frame===undefined)frame=window.requestAnimationFrame(()=>{frame=undefined;measure();});};
    measure();window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(schedule);if(element.parentElement)observer?.observe(element.parentElement);
    return()=>{window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true);observer?.disconnect();if(frame!==undefined)window.cancelAnimationFrame(frame);};
  },[open,floating]);
  useEffect(()=>{if(focus.current==='composer') composer.current?.focus(); if(focus.current==='trigger') trigger.current?.focus(); focus.current=null;},[open]);
  function toggle(next:boolean) {focus.current=next?'composer':'trigger';setLocalOpen(next);onExpandedChange?.(next);}
  async function send() {
    const text=message.trim(); if(lock.current||disabled||busy||loading||!text||text.length>8000) return;
    composer.current?.focus();
    following.current=true;followRequested.current=true;
    lock.current=true;setSending(true);setSendError('');
    try {await onSend(text);setMessage(current=>current===message?'':current);} catch {setSendError('Não foi possível confirmar o envio. Você pode retomar sem perder a mensagem.');}
    finally {lock.current=false;setSending(false);}
  }
  async function retry() {
    if(!onRetry||lock.current||disabled||busy)return;
    composer.current?.focus();
    const failedSend=!!sendError,previous=message;lock.current=true;setSending(true);
    following.current=true;followRequested.current=true;
    try{await onRetry();setSendError('');if(failedSend)setMessage(current=>current===previous?'':current);}
    catch{setSendError('Não foi possível retomar. Sua mensagem permanece disponível para outra tentativa.');}
    finally{lock.current=false;setSending(false);}
  }
  return <aside ref={dock} className={`chat-dock ${floating?'chat-dock--floating ':''}${open?'chat-dock-open':'chat-dock-collapsed'}`} aria-label={`Assistente de ${context.label}`} data-context={context.id}>
    {floating&&!open&&!hintDismissed&&hintIndex>=0&&hints[hintIndex]&&<div className="chat-dock-hint" key={`${pageKey}:${hintIndex}`}><button type="button" className="chat-dock-hint-open" onClick={()=>toggle(true)}><strong>A Zyon pode ajudar</strong><span>{hints[hintIndex]}</span></button><button type="button" className="chat-dock-hint-dismiss" aria-label="Dispensar dica" onClick={()=>setHintDismissed(true)}><X size={15} aria-hidden="true"/></button></div>}
    <button type="button" className="chat-dock-trigger" aria-label="Abrir assistente" aria-controls={id} aria-expanded={open} hidden={!floating&&open} ref={trigger} onClick={()=>open?composer.current?.focus():toggle(true)}>{floating?<><ZyonAgentOrb size={52}/><span className="chat-dock-sr-only">Conversar com a Zyon</span></>:'Conversar com a IA'}</button>
    <section id={id} className="chat-dock-panel" hidden={!open} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();toggle(false);}}}>
      <header className="chat-dock-header"><div className="chat-dock-identity">{floating?<ZyonAgentOrb size={32}/>:<MessageSquare size={18} aria-hidden="true"/>}<div><strong>Assistente Zyon</strong><span>{context.label}</span></div></div><button type="button" className="chat-dock-close" aria-label="Recolher assistente" title="Recolher assistente" onClick={()=>toggle(false)}><ChevronDown size={17} aria-hidden="true"/><span className="chat-dock-sr-only">Recolher</span></button></header>
      {headerExtra}
      <div ref={history} className="chat-dock-history" role="log" aria-label="Conversa com a IA" aria-live="polite" tabIndex={0} onScroll={event=>{const el=event.currentTarget;following.current=el.scrollHeight-el.scrollTop-el.clientHeight<=32;}}><div ref={messages} className="chat-dock-messages">
        {older}{loading&&<p role="status">Carregando conversa…</p>}
        {!loading&&!turns.length&&(empty??<p>Descreva o que você quer fazer. Eu ajudo com os próximos passos.</p>)}
        {turns.map(turn=><article className="chat-dock-turn" key={turn.id} data-turn-id={turn.id}><div className="chat-dock-user"><strong>Você</strong><p>{turn.message}</p></div><div className="chat-dock-reply"><strong>{floating&&<ZyonAgentOrb size={23}/>}Assistente</strong>{turn.reply&&<p>{turn.reply}</p>}{['queued','running'].includes(turn.status)&&<p role="status">Processando sua mensagem…</p>}{turn.status==='unknown'&&<p role="status">Resultado ainda desconhecido. Consulte o histórico antes de repetir a ação.</p>}{turn.status==='failed'&&<p role="status">Este turno não foi concluído. Consulte os detalhes antes de continuar.</p>}{renderTurnDetails?.(turn)}</div></article>)}
      </div></div>
      <form className="chat-dock-composer" onSubmit={event=>{event.preventDefault();void send();}}>
        {(error||sendError)&&<div role="alert"><p>{error||sendError}</p>{onRetry&&<button type="button" disabled={disabled||sending||busy} onClick={()=>void retry()}>Retomar envio</button>}</div>}
        <label className="chat-dock-sr-only" htmlFor={`${id}-message`}>Mensagem para a IA</label><textarea ref={composer} id={`${id}-message`} aria-label="Mensagem para a IA" placeholder="Descreva sua ideia ou faça uma pergunta…" value={message} rows={3} maxLength={8000} onChange={event=>setMessage(event.target.value)} aria-describedby={`${id}-limit`}/>
        <div className="chat-dock-send"><small id={`${id}-limit`}>{message.length}/8000</small><button type="submit" disabled={disabled||loading||busy||sending||!message.trim()||message.trim().length>8000}>Enviar mensagem<ArrowUp size={15} aria-hidden="true"/></button></div>
        {(busy||sending)&&<span role="status">Processando… Você pode recolher o chat e continuar na página.</span>}
      </form>
    </section>
  </aside>;
}
