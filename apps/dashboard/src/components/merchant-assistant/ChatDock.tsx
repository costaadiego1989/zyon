import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { AssistantContextDescriptor, AssistantTurn } from '@zyon/shared-types';
import './chat-dock.css';

export interface ChatDockProps {
  context: AssistantContextDescriptor; turns: AssistantTurn[]; loading?: boolean; busy?: boolean;
  error?: string; empty?: ReactNode; headerExtra?: ReactNode;
  onSend: (message: string) => Promise<void>; onRetry?: () => void | Promise<void>;
  renderTurnDetails?: (turn: AssistantTurn) => ReactNode;
  older?: ReactNode;
}
export function ChatDock({context,turns,loading,busy,error,empty,headerExtra,onSend,onRetry,renderTurnDetails,older}: ChatDockProps) {
  const [open,setOpen]=useState(()=>typeof matchMedia==='undefined'||!matchMedia('(max-width: 900px)').matches);
  const [message,setMessage]=useState(''); const [sending,setSending]=useState(false); const [sendError,setSendError]=useState('');
  const lock=useRef(false), focus=useRef<'composer'|'trigger'|null>(null); const composer=useRef<HTMLTextAreaElement>(null), trigger=useRef<HTMLButtonElement>(null); const id=useId();
  useEffect(()=>{if(focus.current==='composer') composer.current?.focus(); if(focus.current==='trigger') trigger.current?.focus(); focus.current=null;},[open]);
  function toggle(next:boolean) {focus.current=next?'composer':'trigger';setOpen(next);}
  async function send() {
    const text=message.trim(); if(lock.current||busy||loading||!text||text.length>8000) return;
    lock.current=true;setSending(true);setSendError('');
    try {await onSend(text);setMessage(current=>current===message?'':current);} catch {setSendError('Não foi possível confirmar o envio. Você pode retomar sem perder a mensagem.');}
    finally {lock.current=false;setSending(false);}
  }
  return <aside className={`chat-dock ${open?'chat-dock-open':'chat-dock-collapsed'}`} aria-label={`Assistente de ${context.label}`} data-context={context.id}>
    <button type="button" className="chat-dock-trigger" aria-label="Abrir assistente" aria-controls={id} aria-expanded={open} hidden={open} ref={trigger} onClick={()=>toggle(true)}>Conversar com a IA</button>
    <section id={id} className="chat-dock-panel" hidden={!open} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();toggle(false);}}}>
      <header className="chat-dock-header"><div><strong>Assistente Zyon</strong><span>{context.label}</span></div><button type="button" className="chat-dock-close" aria-label="Recolher assistente" onClick={()=>toggle(false)}>Recolher</button></header>
      {headerExtra}
      <div className="chat-dock-history" role="log" aria-label="Conversa com a IA" aria-live="polite" tabIndex={0}>
        {older}{loading&&<p role="status">Carregando conversa…</p>}
        {!loading&&!turns.length&&(empty??<p>Descreva o que você quer fazer. Eu ajudo com os próximos passos.</p>)}
        {turns.map(turn=><article className="chat-dock-turn" key={turn.id} data-turn-id={turn.id}><div className="chat-dock-user"><strong>Você</strong><p>{turn.message}</p></div><div className="chat-dock-reply"><strong>Assistente</strong>{turn.reply&&<p>{turn.reply}</p>}{['queued','running'].includes(turn.status)&&<p role="status">Processando sua mensagem…</p>}{turn.status==='unknown'&&<p role="status">Resultado ainda desconhecido. Consulte o histórico antes de repetir a ação.</p>}{turn.status==='failed'&&<p role="status">Este turno não foi concluído. Consulte os detalhes antes de continuar.</p>}{renderTurnDetails?.(turn)}</div></article>)}
      </div>
      <form className="chat-dock-composer" onSubmit={event=>{event.preventDefault();void send();}}>
        {(error||sendError)&&<div role="alert"><p>{error||sendError}</p>{onRetry&&<button type="button" disabled={sending||busy} onClick={()=>void onRetry()}>Retomar envio</button>}</div>}
        <label htmlFor={`${id}-message`}>Mensagem para a IA</label><textarea ref={composer} id={`${id}-message`} aria-label="Mensagem para a IA" value={message} rows={3} maxLength={8000} onChange={event=>setMessage(event.target.value)} aria-describedby={`${id}-limit`}/>
        <div className="chat-dock-send"><small id={`${id}-limit`}>{message.length}/8000</small><button type="submit" disabled={loading||busy||sending||!message.trim()||message.trim().length>8000}>Enviar mensagem</button></div>
        {(busy||sending)&&<span role="status">Processando… Você pode recolher o chat e continuar na página.</span>}
      </form>
    </section>
  </aside>;
}
