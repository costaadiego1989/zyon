import {useCallback,useRef,useState} from "react";
import type {KnowledgeOperation,SalesKnowledgeAnswer,SalesKnowledgeSource,SaveSalesKnowledge} from "@zyon/shared-types";
import {Button,ReadState,dateTime,useAction,useResource,type PageProps} from "./screen-controls.js";
import {PlatformApiError} from "../../lib/api.js";
const labels={draft:"Rascunho",projecting:"Publicação em processamento",published:"Publicada",withdrawn:"Retirada",failed:"Falha na publicação"};
const operations:Record<KnowledgeOperation,string>={answer_faq:"Pergunta frequente",explain_feature:"Funcionalidade",compare_plans:"Comparar planos",integration_capability:"Integração"};
const fresh=()=>({id:crypto.randomUUID(),subject:"",predicate:"faq",value:""});
export function SalesKnowledgePage(props:PageProps&{modelMode?:"controlled"|"disabled"|"live"}){
 const load=useCallback((s:AbortSignal)=>props.api.knowledge(s),[props.api]);const list=useResource(load,props.onSessionExpired);
 const [editor,setEditor]=useState<{id:string;source:SalesKnowledgeSource|null}|null>(null);
 return <section className="prospecting-page"><header><h2>Conhecimento comercial</h2><p>Revise as fontes que a IA pode consultar nas conversas.</p></header>
 {!list.data?<ReadState {...list}/>:<><div className="prospecting-actions"><Button primary onClick={()=>setEditor({id:crypto.randomUUID(),source:null})}>Nova fonte</Button></div>
 {!list.data.items.length&&<p>Nenhuma fonte cadastrada.</p>}<div>{list.data.items.map(s=><div className="prospecting-row" key={s.id}><Button onClick={()=>setEditor({id:s.id,source:s})}>{s.title}</Button><span>{labels[s.state]} · versão {s.version}</span></div>)}</div></>}
 {editor&&!list.error&&<Draft key={editor.id} {...props} sourceId={editor.id} initial={editor.source} refresh={list.reload}/>}
 <Question {...props}/><p>Modelos nas conversas · {props.modelMode==="live"?"Uso real sujeito a autorização e orçamento":props.modelMode==="controlled"?"Execução controlada":"Uso pago desativado"}. As ofertas e os preços vêm do catálogo de planos.</p></section>;
}
function Draft(props:PageProps&{sourceId:string;initial:SalesKnowledgeSource|null;refresh:()=>void}){
 const {api,sourceId,initial,refresh}=props;const [source,setSource]=useState(initial);
 const [title,setTitle]=useState(initial?.title??""),[ref,setRef]=useState(initial?.sourceRef??""),[from,setFrom]=useState(initial?.validFrom.slice(0,10)??new Date().toISOString().slice(0,10)),[until,setUntil]=useState(initial?.validUntil?.slice(0,10)??"");
 const [facts,setFacts]=useState<SaveSalesKnowledge["facts"]>(initial?.draft.map(({id,subject,predicate,value})=>({id,subject,predicate,value}))??[fresh()]),[dirty,setDirty]=useState(!initial);
 async function read(){setSource(await api.source(sourceId));refresh();}
 const action=useAction(props,"knowledge."+sourceId,()=>{void read().catch(refresh);});
 function change(index:number,key:"subject"|"predicate"|"value",value:string){setDirty(true);setFacts(prev=>prev.map((f,i)=>i===index?{...f,[key]:value}:f));}
 function publish(kind:"publish"|"withdraw"){if(!source)return;void action.run(async k=>{const version=kind==="publish"?source.version:source.activePublicationVersion,hash=kind==="publish"?source.contentHash:source.activeContentHash;
  if(!version||!hash)throw Error("publication_unavailable");await api.publishOrWithdraw(sourceId,{clientRequestId:k,expectedVersion:version,contentHash:hash,action:kind});await read();return kind==="publish"?"Publicação confirmada.":"Retirada confirmada.";});}
 return <section className="prospecting-page"><header><h3>{source?.title??"Nova fonte"}</h3>{source&&<p>{labels[source.state]} · versão {source.version} · {dateTime(source.updatedAt)}</p>}<p>{source?.activePublicationId?"Publicação ativa · versão "+(source.activePublicationVersion??"indisponível"):"Sem publicação ativa"}</p></header>
 <form onChange={()=>setDirty(true)} onSubmit={e=>{e.preventDefault();void action.run(async k=>{const saved=await api.saveKnowledge({clientRequestId:k,sourceId,expectedVersion:source?.version??0,title,sourceRef:ref,validFrom:source?.validFrom.slice(0,10)===from?source.validFrom:new Date(from).toISOString(),validUntil:until?(source?.validUntil?.slice(0,10)===until?source.validUntil:new Date(until).toISOString()):null,facts});setSource(saved);setDirty(false);refresh();return "Rascunho salvo.";});}}>
 <div className="prospecting-fields"><label>Título da fonte<input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label><label>Referência de origem<input required maxLength={500} value={ref} onChange={e=>setRef(e.target.value)}/></label>
 <label>Válida a partir de (UTC)<input type="date" required value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Válida até (UTC)<input type="date" value={until} onChange={e=>setUntil(e.target.value)}/></label></div>
 {facts.map((f,i)=><fieldset key={f.id}><legend>Informação {i+1}</legend><div className="prospecting-fields"><label>Tipo<select value={f.predicate} onChange={e=>change(i,"predicate",e.target.value)}>{Object.entries({feature:"Funcionalidade",plan:"Plano",integration:"Integração",faq:"Pergunta frequente"}).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
 <label>Assunto<input required maxLength={160} value={f.subject} onChange={e=>change(i,"subject",e.target.value)}/></label></div><label>Informação publicada<textarea required maxLength={1200} value={f.value} onChange={e=>change(i,"value",e.target.value)}/></label>
 {facts.length>1&&<Button onClick={()=>{setDirty(true);setFacts(facts.filter(x=>x.id!==f.id));}}>Remover informação</Button>}</fieldset>)}
 <div className="prospecting-actions"><Button onClick={()=>{setDirty(true);setFacts([...facts,fresh()]);}}>Adicionar informação</Button><Button type="submit" disabled={action.disabled||!dirty} primary>Salvar rascunho</Button></div></form>
 {action.feedback}<div className="prospecting-actions">{source&&!["published","withdrawn","projecting"].includes(source.state)&&<Button onClick={()=>publish("publish")} disabled={dirty||action.disabled}>Publicar versão</Button>}{source?.activePublicationId&&<Button disabled={action.disabled} onClick={()=>publish("withdraw")}>Retirar publicação</Button>}</div></section>;
}
function Question({api,onSessionExpired}:PageProps){
 const [op,setOp]=useState<KnowledgeOperation>("answer_faq"),[text,setText]=useState(""),[result,setResult]=useState<SalesKnowledgeAnswer|null>(null),[error,setError]=useState<unknown>(),[busy,setBusy]=useState(false);const revision=useRef(0);
 function reset(){revision.current++;setResult(null);setError(undefined);setBusy(false);}
 async function ask(){const current=++revision.current;setResult(null);setError(undefined);setBusy(true);try{const params=op==="compare_plans"?{planKeys:text.split(",").map(v=>v.trim())}:op==="answer_faq"?{question:text}:op==="explain_feature"?{feature:text}:{integration:text};
  const answer=await api.queryKnowledge({operation:op,params,limit:10});if(current===revision.current)setResult(answer);
 }catch(e){if(current===revision.current){if(e instanceof PlatformApiError&&e.status===401)onSessionExpired();setError(e);}}finally{if(current===revision.current)setBusy(false);}}
 return <section className="prospecting-page"><h3>Testar cobertura da base</h3><form onSubmit={e=>{e.preventDefault();void ask();}}><div className="prospecting-fields"><label>Operação<select value={op} onChange={e=>{reset();setOp(e.target.value as KnowledgeOperation);}}>{Object.entries(operations).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label><label>{op==="compare_plans"?"Planos separados por vírgula":"Pergunta ou assunto"}<input required value={text} onChange={e=>{reset();setText(e.target.value);}}/></label></div><Button type="submit" disabled={busy||!text.trim()}>Testar pergunta</Button></form>
 {busy&&<p role="status">Consultando fontes publicadas…</p>}{error?<ReadState error={error} reload={ask}/>:null}{result&&<div aria-live="polite"><strong>{result.handoff?"Encaminhar ao atendimento humano":result.answer}</strong><p>{result.callMode==="controlled"?"Consulta controlada, sem consumo pago.":"Chamada real de modelo."}</p>{result.sources.map(s=><p key={s.id+s.version}>{s.id} · versão {s.version}</p>)}{result.facts.map(f=><p key={f.publicationId+f.id}>{f.subject} · {f.value}</p>)}</div>}</section>;
}
