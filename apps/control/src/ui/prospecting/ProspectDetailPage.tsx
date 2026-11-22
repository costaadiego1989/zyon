import {useCallback,useState} from "react";
import type {ProspectConversionHistoryItem,ProspectStage} from "@zyon/shared-types";
import {ProspectChat} from "./ProspectChat.js";
import {ProspectingState,type ProspectRoute} from "./ProspectingShell.js";
import {Button,dateTime,money,ReadState,stages,useAction,useResource,type PageProps} from "./screen-controls.js";
export const conversionLabels:Record<ProspectConversionHistoryItem["state"],string>={account_bound:"Conta vinculada",signup:"Cadastro",trial:"Período de teste",paid:"Pagamento confirmado",refunded:"Reembolso integral",allocation_coverage_unknown:"Cobertura de alocação desconhecida"};
export const permissions={opted_in:"Opt-in registrado",no_opt_in:"Sem opt-in",revoked:"Permissão revogada"};
const confirmation={ambiguous:"Vínculo ambíguo",confirmed:"Vínculo confirmado",unconfirmed:"Vínculo sem confirmação"};
type Props=PageProps&{route:ProspectRoute;operators?:{id:string;label:string}[]};
export function ProspectDetailPage(props:Props){
 return props.route.id?<Detail key={props.route.id} {...props} id={props.route.id}/>:<Leads key={JSON.stringify(props.route.filters)} {...props}/>;
}
function Leads({api,navigate,onSessionExpired,route}:Props){
 const [search,setSearch]=useState(route.filters?.search??""),[applied,setApplied]=useState(search),[cursor,setCursor]=useState<string>();
 const {campaignId,from,to}=route.filters??{};
 const load=useCallback((signal:AbortSignal)=>api.prospects({search:applied||undefined,campaignId,from,to,cursor,limit:30},signal),[api,applied,campaignId,from,to,cursor]);
 const result=useResource(load,onSessionExpired);
 return <section className="prospecting-page"><header><h2>Leads</h2><p>Empresas adicionadas ao CRM.</p></header>
  {(from||campaignId)&&<p>Período {dateTime(from)} até {dateTime(to)} · Campanha {campaignId??"Todas"}</p>}
  <form className="prospecting-actions" onSubmit={e=>{e.preventDefault();setCursor(undefined);setApplied(search.trim());}}><label>Buscar por CNPJ<input value={search} onChange={e=>setSearch(e.target.value)}/></label><Button type="submit">Pesquisar</Button></form>
  {!result.data?<ReadState {...result}/>:<>{!result.data.items.length&&<ProspectingState state="empty" message="Nenhum lead encontrado."/>}
   <div>{result.data.items.map(p=><div key={p.id} className="prospecting-row"><Button onClick={()=>navigate({...route,id:p.id,filters:{...route.filters,search:applied}})}>{p.cnpj}</Button><span>{stages[p.stage]}</span><span>{p.lastReplyPreview??"Sem resposta recebida"}</span></div>)}</div>
   <div className="prospecting-actions">{cursor&&<Button onClick={()=>setCursor(undefined)}>Primeira página</Button>}{result.data.nextCursor&&<Button onClick={()=>setCursor(result.data!.nextCursor!)}>Próxima página</Button>}</div></>}
 </section>;
}
function Conversions({api,id,onSessionExpired}:Pick<Props,"api"|"onSessionExpired">&{id:string}){
 const [cursor,setCursor]=useState<string>(),[previous,setPrevious]=useState<ProspectConversionHistoryItem[]>([]);
 const load=useCallback((s:AbortSignal)=>api.conversions(id,{cursor,limit:25},s),[api,id,cursor]);const result=useResource(load,onSessionExpired);
 return <section><h3>Histórico de conversão</h3>{!result.data?<ReadState {...result}/>:<>
  {!result.data.items.length&&!previous.length&&<p>Nenhuma conversão registrada.</p>}
  <ol>{[...previous,...result.data.items].map(v=><li key={v.id}><strong>{conversionLabels[v.state]}</strong> · {v.planKey} · {v.provider} · {dateTime(v.occurredAt)}</li>)}</ol>
  {result.data.nextCursor&&<Button onClick={()=>{setPrevious([...previous,...result.data!.items]);setCursor(result.data!.nextCursor!);}}>Conversões anteriores</Button>}</>}</section>;
}
function Detail(props:Props&{id:string}){
 const {api,id,onSessionExpired,operatorId,navigate,route}=props;
 const load=useCallback((s:AbortSignal)=>api.prospect(id,s),[api,id]);const result=useResource(load,onSessionExpired);
 const action=useAction(props,"lead."+id,result.reload);const [confirm,setConfirm]=useState(false),[reason,setReason]=useState(""),[chat,setChat]=useState(false);
 const detail=result.data,p=detail?.prospect,c=detail?.company;
 return <section className="prospecting-page"><div><Button onClick={()=>navigate({area:"leads",filters:route.filters})}>Voltar aos leads</Button></div>
  {action.feedback}{!p||!detail?<ReadState {...result}/>:<><header><h2>{c?.legalName??p.cnpj}</h2><p>{p.cnpj} · Competência {c?.competence??"indisponível"}</p></header>
  <dl>{Object.entries({"Nome fantasia":c?.tradeName,"Localização":[c?.district,c?.uf].filter(Boolean).join(" · "),"CNAE principal":c?.mainCnae,"Capital social":c?.capitalCents?money(c.capitalCents):null,"Estágio":stages[p.stage],"Responsável":props.operators?.find(x=>x.id===p.assignedOperatorId)?.label??p.assignedOperatorId,"Primeira tentativa":dateTime(p.firstAttemptAt),"Última tentativa":dateTime(p.lastAttemptAt),"Primeira entrega":dateTime(p.firstDeliveredAt),"Última entrega":dateTime(p.lastDeliveredAt),"Última resposta recebida":p.lastReplyPreview,"Recebida em":dateTime(p.lastReplyAt)}).map(([k,v])=><div key={k}><dt>{k}</dt><dd>{v||"Sem registro"}</dd></div>)}</dl>
  {!p.suppressed&&<form key={p.version} onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void action.run(async k=>{await api.updateProspect(id,{clientRequestId:k,expectedVersion:p.version,stage:data.get("stage") as ProspectStage,assignedOperatorId:String(data.get("owner")||"")||null,tags:String(data.get("tags")??"").split(",").map(s=>s.trim()).filter(Boolean)});result.reload();return "Lead atualizado.";});}}>
   <div className="prospecting-fields"><label>Alterar estágio<select name="stage" defaultValue={p.stage}>{Object.entries(stages).filter(([k])=>k!=="do_not_contact").map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
   <label>Atribuir responsável<select name="owner" defaultValue={p.assignedOperatorId??""}><option value="">Sem responsável</option>{[...new Map([{id:operatorId,label:"Eu"},...(p.assignedOperatorId?[{id:p.assignedOperatorId,label:p.assignedOperatorId}]:[]),...(props.operators??[])].map(o=>[o.id,o])).values()].map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label><label>Etiquetas separadas por vírgula<input name="tags" defaultValue={p.tags.join(", ")}/></label></div><Button disabled={action.disabled} type="submit">Salvar lead</Button></form>}
  <section><h3>Contatos cadastrais</h3>{c?.contacts.length?c.contacts.map((a,i)=><p key={i}>{a.channel==="phone"?"Telefone":"E-mail"} · {a.originalValue}</p>):<p>Sem contato na fonte.</p>}</section>
  <section><h3>Identidade e permissão</h3>{!p.contacts.length&&<p>Nenhum vínculo de contato.</p>}{p.contacts.map(a=><div key={a.endpointId} className="prospecting-row"><div><strong>{a.identity?.value??a.normalizedValue??"Identidade desconhecida"}</strong><small>{a.identity?.kind==="bsuid"?"Identificador do provedor · ":""}{confirmation[a.confirmationState]} · {permissions[a.permission]}</small></div>
  {!p.suppressed&&a.confirmationState!=="confirmed"&&<form className="prospecting-actions" onSubmit={e=>{e.preventDefault();const ref=String(new FormData(e.currentTarget).get("ref")).trim();if(ref)void action.run(async k=>{await api.bindContact(id,{clientRequestId:k,expectedVersion:p.version,endpointId:a.endpointId,evidenceRef:ref});result.reload();return "Vínculo confirmado pelo servidor.";});}}><label>Referência da evidência<input required name="ref"/></label><Button type="submit" disabled={action.disabled}>Confirmar identidade</Button></form>}</div>)}</section>
  {p.suppressed?<p><strong>Contato bloqueado</strong></p>:confirm?<form onSubmit={e=>{e.preventDefault();void action.run(async k=>{const receipt=await api.suppress(id,{clientRequestId:k,expectedVersion:p.version,reason:reason.trim()});result.reload();setConfirm(false);return "Contato bloqueado. "+receipt.cancelledAttempts+" cancelada(s) e "+receipt.inFlightAttempts+" em andamento.";});}}><h3>Bloquear novos contatos com esta empresa?</h3><label>Motivo do bloqueio<input required value={reason} onChange={e=>setReason(e.target.value)}/></label><div className="prospecting-actions"><Button type="submit" disabled={action.disabled||!reason.trim()}>Confirmar não contatar</Button><Button onClick={()=>setConfirm(false)}>Cancelar</Button></div></form>:<div><Button onClick={()=>setConfirm(true)} disabled={action.disabled}>Não contatar</Button></div>}
  <Conversions api={api} id={id} onSessionExpired={onSessionExpired}/>
  {detail.conversationId?<>{chat?<ProspectChat api={api} operatorId={operatorId} onSessionExpired={onSessionExpired} conversationId={detail.conversationId}/>:<div><Button onClick={()=>setChat(true)}>Abrir conversa</Button></div>}</>:<p>Nenhuma conversa vinculada à empresa.</p>}</>}
 </section>;
}
