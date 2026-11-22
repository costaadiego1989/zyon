import {useCallback,useEffect,useState} from "react";
import {ProspectChat} from "./ProspectChat.js";
import {ProspectingState,type ProspectRoute} from "./ProspectingShell.js";
import {Button,dateTime,ReadState,useResource,type PageProps} from "./screen-controls.js";
export function ProspectingInbox({api,route,navigate,onSessionExpired,operatorId,operators=[]}:PageProps&{route:ProspectRoute;operators?:{id:string;label:string}[]}){
 const {campaignId,search,assignedOperatorId,unread,cursor}=route.filters??{};
 const [text,setText]=useState(search??""),[mine,setMine]=useState(assignedOperatorId??""),[campaign,setCampaign]=useState(campaignId??""),[onlyUnread,setOnlyUnread]=useState(unread==="true");
 useEffect(()=>{setText(search??"");setMine(assignedOperatorId??"");setCampaign(campaignId??"");setOnlyUnread(unread==="true");},[search,assignedOperatorId,campaignId,unread]);
 const getCampaigns=useCallback(async(s:AbortSignal)=>{const items=[];let after:string|undefined;do{const page=await api.campaigns(after,s);items.push(...page.items);after=page.nextCursor??undefined;}while(after);return items;},[api]);
 const choices=useResource(getCampaigns,onSessionExpired);
 const load=useCallback((s:AbortSignal)=>api.conversations({unread:unread==="true"||undefined,assignedOperatorId:assignedOperatorId||undefined,campaignId:campaignId||undefined,search:search||undefined,cursor,limit:30},s),[api,unread,assignedOperatorId,campaignId,search,cursor]);const list=useResource(load,onSessionExpired);
 useEffect(()=>{const refresh=list.reload;const timer=window.setInterval(refresh,30000);window.addEventListener("focus",refresh);window.addEventListener("online",refresh);return ()=>{clearInterval(timer);window.removeEventListener("focus",refresh);window.removeEventListener("online",refresh);};},[list.reload]);
 function next(filters:Record<string,string>){navigate({area:"conversations",filters:Object.fromEntries(Object.entries(filters).filter(([,v])=>v))});}
 return <section className="prospecting-page"><header><h2>Conversas</h2><p>Últimas respostas recebidas e fila de atendimento.</p></header>
 <form onSubmit={e=>{e.preventDefault();next({search:text.trim(),assignedOperatorId:mine,campaignId:campaign,unread:onlyUnread?"true":""});}}><div className="prospecting-fields">
 <label>Buscar resposta ou CNPJ<input value={text} onChange={e=>setText(e.target.value)}/></label>
 <label>Responsável<select value={mine} onChange={e=>setMine(e.target.value)}><option value="">Todos</option>{[...new Map([{id:operatorId,label:"Minhas conversas"},...operators,...(assignedOperatorId&&assignedOperatorId!==operatorId&&!operators.some(o=>o.id===assignedOperatorId)?[{id:assignedOperatorId,label:assignedOperatorId}]:[])].map(o=>[o.id,o])).values()].map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label>
 <label>Campanha<select value={campaign} onChange={e=>setCampaign(e.target.value)}><option value="">Todas</option>{choices.data?.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label></div>
 <div className="prospecting-actions"><label className="prospecting-check"><span>Não lidas</span><input type="checkbox" aria-label="Não lidas" checked={onlyUnread} onChange={e=>setOnlyUnread(e.target.checked)}/></label><Button type="submit" primary>Aplicar filtros</Button></div></form>
 {choices.error?<ReadState {...choices}/>:null}{!list.data?<ReadState {...list}/>:<>
 {!list.data.items.length&&<ProspectingState state="empty" message="Nenhuma conversa corresponde aos filtros."/>}
 <div>{list.data.items.map(c=><div key={c.id} className="prospecting-row"><div><strong>{c.lastInboundPreview??"Sem resposta recebida"}</strong><small>{dateTime(c.lastInboundAt)} · {c.unreadCount} não lida(s)</small></div><span>{c.mode==="ai"?"IA Zyon":operators.find(o=>o.id===c.assignedOperatorId)?.label??c.assignedOperatorId??"Atendimento humano"}</span>
 <Button onClick={()=>navigate({...route,id:c.id})}>Abrir conversa</Button></div>)}</div>
 <div className="prospecting-actions">{cursor&&<Button onClick={()=>next({...route.filters,cursor:""})}>Primeira página</Button>}{list.data.nextCursor&&<Button onClick={()=>next({...route.filters,cursor:list.data!.nextCursor!})}>Próxima página</Button>}</div></>}
 {route.id&&!list.error&&<><div><Button onClick={()=>navigate({...route,id:undefined})}>Fechar conversa</Button></div><ProspectChat conversationId={route.id} api={api} operatorId={operatorId} onSessionExpired={onSessionExpired}/></>}
 </section>;
}
