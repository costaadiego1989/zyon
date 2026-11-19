import { useEffect, useRef, useState } from 'react';
import type { AssistantThread, AssistantTurn, AssistantTurnInput } from '@zyon/shared-types';
import { merchantAssistantEndpoints, type AssistantSourceView, type MerchantAssistantApi } from '../../api/endpoints/merchant-assistant.js';
import { createIdempotencyKey } from '../../api/http/idempotency.js';

export type CashbackAssistantClient = Pick<MerchantAssistantApi, 'thread' | 'page' | 'submit' | 'source'>;
interface Options {
  apiBaseUrl: string;
  merchantId: string;
  /** Canonical shell scope. Changes even when the API instance is shared. */
  scopeKey: string;
  client?: CashbackAssistantClient;
  onDraftUpdated?: () => void | Promise<unknown>;
  pollMs?: number;
}
interface State { thread: AssistantThread | null; loading: boolean; admitting: boolean; error: string | null; source: AssistantSourceView | null; sourceError: string | null; olderLoading: boolean; }
interface Scope { client: CashbackAssistantClient; abort: AbortController; merchantId: string; thread: AssistantThread | null; operation: {threadId: string; input: AssistantTurnInput} | null; admitting: boolean; seenDrafts: Set<string>; sourceRequest: number; }
const initial = (): State => ({thread:null,loading:true,admitting:false,error:null,source:null,sourceError:null,olderLoading:false});
const unavailable = 'Assistente indisponível. Continue pela configuração manual ou tente novamente.';
const uncertain = 'Não foi possível confirmar o envio. Consulte o resultado antes de tentar novamente.';
const unknown = 'O resultado desta solicitação ainda é desconhecido. Consulte novamente antes de enviar outra mensagem.';
const activeTurn = (t: AssistantTurn) => t.status === 'queued' || t.status === 'running';
const mergeTurns = (older: AssistantTurn[], current: AssistantTurn[]) => Array.from(new Map([...older,...current].map(t=>[t.id,t])).values()).sort((a,b)=>a.ordinal-b.ordinal);

/** One conversation lifetime belongs to one authenticated merchant scope. */
export function useCashbackAssistant({apiBaseUrl,merchantId,scopeKey,client,onDraftUpdated,pollMs=1500}: Options) {
  const [state,setState] = useState<State>(initial);
  const scope = useRef<Scope | null>(null);
  const notify = useRef(onDraftUpdated); notify.current = onDraftUpdated;
  const alive = (s: Scope) => scope.current === s && !s.abort.signal.aborted;
  function accept(s: Scope, data: AssistantThread, older=false) {
    if (!alive(s)) return;
    const turns = data.turns.map(t=>({...t,artifacts:t.artifacts.filter(a=>a.type === 'cashback_draft' ? a.program.merchantId === s.merchantId : a.type === 'cashback_report' && a.report.merchantId === s.merchantId)}));
    const next = {...data,revision:Math.max(data.revision,s.thread?.revision || 0),turns:older ? mergeTurns(turns,s.thread?.turns || []) : mergeTurns(s.thread?.turns || [],turns),nextCursor:older ? data.nextCursor : s.thread ? s.thread.nextCursor : data.nextCursor};
    s.thread = next;
    setState(v=>({...v,thread:next,loading:false,error:turns.some(t=>t.status === 'unknown') ? unknown : null}));
    let draftChanged = false;
    for (const t of turns) {
      if (t.status !== 'completed' || !t.artifacts.some(a=>a.type === 'cashback_draft') || s.seenDrafts.has(t.id)) continue;
      s.seenDrafts.add(t.id);
      draftChanged = true;
    }
    // One current read per history batch; original receipt snapshots may be old.
    if(draftChanged)void Promise.resolve(notify.current?.()).catch(()=>{if(alive(s))setState(v=>({...v,error:'O rascunho foi atualizado. Recarregue a configuração para conferir os dados atuais.'}));});
  }
  async function read(s: Scope) {
    const data = await s.client.thread('cashback',s.abort.signal);
    accept(s,data);
    return data;
  }
  async function admit(s: Scope) {
    if (!s.operation || !alive(s)) return;
    const operation = s.operation;
    s.admitting = true; setState(v=>({...v,admitting:true,error:null}));
    try {
      const result = await s.client.submit('cashback',operation.threadId,operation.input,s.abort.signal);
      if (!alive(s)) return;
      s.operation = null;
      if (s.thread) accept(s,{...s.thread,revision:result.revision,turns:[result.turn]});
    } catch (error) {
      if (!alive(s)) return;
      const status = (error as {status?:number}).status;
      if (status && status >= 400 && status < 500 && status !== 408) {
        s.operation = null;
        if (status === 409) { try {await read(s);} catch { /* Retain the visible failure. */ } }
        if(alive(s))setState(v=>({...v,error:'Não foi possível enviar esta mensagem. Confira a conversa e tente novamente.'}));
      } else setState(v=>({...v,error:uncertain}));
      throw error;
    } finally { s.admitting=false;if(alive(s))setState(v=>({...v,admitting:false})); }
  }
  useEffect(()=>{
    const owned = client ? null : merchantAssistantEndpoints(apiBaseUrl);
    const s: Scope = {client:client || owned!,abort:new AbortController(),merchantId,thread:null,operation:null,admitting:false,seenDrafts:new Set(),sourceRequest:0};
    scope.current=s;setState(initial());
    void read(s).catch(()=>{if(alive(s))setState(v=>({...v,loading:false,error:unavailable}));});
    return ()=>{s.abort.abort();owned?.dispose();if(scope.current === s)scope.current=null;};
    // The explicit scope protects same-client merchant/session changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[apiBaseUrl,merchantId,scopeKey,client]);
  useEffect(()=>{
    const s=scope.current;
    if(!s || !state.thread?.turns.some(activeTurn) || state.admitting) return;
    const timer=setTimeout(()=>{void read(s).catch(()=>{if(alive(s))setState(v=>({...v,error:'Não foi possível atualizar a conversa. Consulte novamente para conferir o resultado.'}));});},pollMs);
    return ()=>clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[state.thread,state.admitting,pollMs,scopeKey]);
  async function send(message: string) {
    const s=scope.current;
    if(!s?.thread || s.admitting || s.operation || s.thread.turns.some(t=>activeTurn(t)||t.status==='unknown'))throw new Error('Conversa aguardando confirmação');
    if(!message.trim())return;
    s.operation={threadId:s.thread.id,input:{message:message.trim(),idempotencyKey:createIdempotencyKey(),expectedRevision:s.thread.revision}};
    await admit(s);
  }
  async function retry() {
    const s=scope.current;if(!s || s.admitting)return false;
    setState(v=>({...v,loading:!s.thread,error:null}));
    try {await read(s);if(alive(s) && s.operation && !s.thread?.turns.some(t=>t.status==='unknown'))await admit(s);return alive(s) && !s.operation && !s.thread?.turns.some(t=>t.status==='unknown');}
    catch {if(alive(s))setState(v=>({...v,loading:false,error:s.operation ? uncertain : unavailable}));return false;}
  }
  async function loadOlder() {
    const s=scope.current;if(!s?.thread?.nextCursor || state.olderLoading)return;
    setState(v=>({...v,olderLoading:true}));
    try {accept(s,await s.client.page('cashback',s.thread.id,s.thread.nextCursor,s.abort.signal),true);}
    catch {if(alive(s))setState(v=>({...v,error:'Não foi possível carregar as mensagens anteriores.'}));}
    finally {if(alive(s))setState(v=>({...v,olderLoading:false}));}
  }
  async function openSource(id: string) {
    const s=scope.current;if(!s)return;
    const request=++s.sourceRequest;
    setState(v=>({...v,source:null,sourceError:null}));
    try {const source=await s.client.source('cashback',id,s.abort.signal);if(alive(s)&&s.sourceRequest===request)setState(v=>({...v,source}));}
    catch {if(alive(s)&&s.sourceRequest===request)setState(v=>({...v,sourceError:'Não foi possível carregar a fonte revisada.'}));}
  }
  const busy = state.admitting || !!state.thread?.turns.some(activeTurn);
  return {...state,turns:state.thread?.turns || [],busy,canSend:!!state.thread && !busy && !scope.current?.operation && !state.thread.turns.some(t=>t.status==='unknown'),send,retry,loadOlder,openSource,closeSource:()=>{if(scope.current)scope.current.sourceRequest++;setState(v=>({...v,source:null,sourceError:null}));}};
}
