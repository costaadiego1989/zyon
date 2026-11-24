import {useCallback,useEffect,useState} from "react";
import type {CampaignPlanningJob,PlatformSenderReadiness,ProspectCampaignDraft,ProspectingSendWindow} from "@zyon/shared-types";
import {PlatformApiError} from "../../lib/api.js";
import {CampaignComposer,campaignStates} from "./CampaignComposer.js";
import {Button,ReadState,cents,blockers,useAction,useResource,type PageProps} from "./screen-controls.js";
import {TemplateManager} from "./TemplateManager.js";

export const planningReasons:Record<string,string>={
 context_scope_unsupported:"Refine o contexto com uma atividade e um estado disponíveis. Exemplo: lojas de roupas em SP.",
 context_scope_unavailable:"A atividade ou região ainda não está disponível nesta base. Confira a busca de empresas.",
 model_disabled:"A interpretação por IA precisa ser habilitada. Você pode refinar o contexto para uma atividade e um estado.",
 planning_budget_missing:"Este contexto precisa de interpretação por IA. Defina um orçamento explícito ou refine a atividade e a região.",
 cost_unknown:"Configure uma cotação de custos válida antes de usar a IA ou enviar mensagens.",
 budget_conflict:"O orçamento disponível não cobre esta preparação. Revise o limite da campanha.",
 planning_outcome_unknown:"A confirmação da preparação está pendente. Consulte o resultado antes de tentar outra operação.",
 approval_stale:"A campanha mudou. Atualize os dados e prepare uma nova revisão.",
};
type Props=PageProps & {id?:string};
export function CampaignWorkspace(props:Props){
 const {api,id,navigate,onSessionExpired}=props;
 const [saved,setSaved]=useState<ProspectCampaignDraft|null>(null),[name,setName]=useState(""),[context,setContext]=useState("");
 const [notice,setNotice]=useState(""),[planning,setPlanning]=useState<CampaignPlanningJob|null>(null);
 const load=useCallback(async(s:AbortSignal)=>{
  if(!id)return {draft:null,legacy:false};
  try{return {draft:await api.draft(id,s),legacy:false};}
  catch(e){if(e instanceof PlatformApiError&&e.status===404)return {draft:null,legacy:true};throw e;}
 },[api,id]);
 const remote=useResource(load,onSessionExpired);
 const current=saved&&(!id||saved.id===id)?saved:remote.data?.draft??null;
 const refresh=useCallback(()=>{remote.reload();},[remote.reload]);
 useEffect(()=>{const c=remote.data?.draft;if(c)setSaved(previous=>previous?.id===c.id&&previous.revision>c.revision?previous:c);},[remote.data]);
 const action=useAction(props,"workspace."+(id??"new"),()=>id?refresh():navigate({area:"campaigns"}));
 const update=useCallback((c:ProspectCampaignDraft)=>setSaved(c),[]);
 async function reloadDraft(campaignId:string){const c=await api.draft(campaignId);setSaved(c);return c;}
 useEffect(()=>{
  if(!planning||!['pending','processing'].includes(planning.state)||planning.campaignId!==current?.id)return;
  const abort=new AbortController();
  const timer=setTimeout(()=>{void api.contextPreparation(planning.campaignId,planning.id,abort.signal).then(async job=>{
   if(abort.signal.aborted)return;setPlanning(job);if(job.state==="completed")await reloadDraft(job.campaignId);
  }).catch(()=>{if(!abort.signal.aborted)setNotice("A campanha está salva. Atualize as empresas para consultar a preparação.");});},2000);
  return ()=>{abort.abort();clearTimeout(timer);};
 },[api,planning,current?.id]);
 if(id&&remote.data?.legacy)return <CampaignComposer {...props}/>;
 if(id&&!current)return <ReadState {...remote}/>;
 return <section className="prospecting-page campaign-workspace">
  <header><h2>{current?.name??"Criar campanha"}</h2><p>{current?`${current.state==='approved'?'Revisão da campanha aprovada':campaignStates[current.state]} · Revisão ${current.revision}`:"Comece pelo nome e pelo contexto das empresas que você quer alcançar."}</p></header>
  {notice&&<p role="status">{notice}</p>}{action.feedback}
  {!current?<form className="campaign-create" onSubmit={event=>{
   event.preventDefault();void action.run(async key=>{
    const c=await api.createDraft({name:name.trim(),...(context.trim()?{businessContext:context.trim()}:{}),clientRequestId:key});
    setSaved(c);setNotice("Campanha criada e salva. Preparando a pesquisa de empresas.");
    navigate({area:"campaigns",id:c.id,filters:{view:"edit"}});
    if(c.businessContext){
     try{
      const source=(await api.readiness()).source;
      if(source.status!=="current"||!source.value?.snapshotId||source.value.state!=="published")throw Error("source_unavailable");
      const job=await api.prepareContext(c.id,{expectedRevision:c.revision,snapshotId:source.value.snapshotId,clientRequestId:key+":context"});
      setPlanning(job);if(job.state==="completed")await reloadDraft(c.id);
      setNotice(job.state==="completed"?"Campanha salva. Empresas preparadas pelo contexto, sem chamada de IA.":job.state==="blocked"?"Campanha salva. "+(planningReasons[job.errorCode??""]??"Refine o contexto para preparar as empresas."):"Campanha salva. A preparação das empresas está em andamento.");
     }catch{setNotice("Campanha criada e salva. A pesquisa de empresas está pendente; tente preparar pelo contexto abaixo.");}
    }else setNotice("Campanha criada e salva. Adicione empresas pela busca ou informe um contexto.");
    return "Rascunho salvo. Nenhuma mensagem foi enviada.";
   });
  }}>
   <label>Nome da campanha<input autoFocus required maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></label>
   <label>Contexto das empresas<textarea aria-label="Contexto das empresas" maxLength={4000} rows={3} placeholder="Ex.: lojas de roupas em SP" value={context} onChange={event=>setContext(event.target.value)}/></label>
   <p>Você pode adicionar empresas e configurar mensagem e envio depois. A pesquisa por atividade e estado pode ser preparada sem conectar o WhatsApp.</p>
   <Button primary type="submit" disabled={!name.trim()||action.disabled}>Criar campanha</Button>
  </form>:<DraftWorkspace key={current.id} {...props} campaign={current} update={update} refresh={refresh} planning={planning} planned={setPlanning}/>}
 </section>;
}
type DraftProps=PageProps & {campaign:ProspectCampaignDraft;update:(c:ProspectCampaignDraft)=>void;refresh:()=>void;planning:CampaignPlanningJob|null;planned:(j:CampaignPlanningJob)=>void};
type ChannelResource=ReturnType<typeof useResource<PlatformSenderReadiness>>;
function DraftWorkspace(props:DraftProps){
 const {api,campaign:c,update,refresh,navigate}=props;
 const [name,setName]=useState(c.name),[context,setContext]=useState(c.businessContext??"");
 const [dirty,setDirty]=useState(false),[sendDirty,setSendDirty]=useState(false);
 const channel=useResource(useCallback((s:AbortSignal)=>api.sender(s),[api]),props.onSessionExpired);
 const refreshWorkspace=useCallback(()=>{refresh();channel.reload();},[refresh,channel.reload]);
 const action=useAction(props,"draft."+c.id,refreshWorkspace);
 const editable=['draft','review_ready','approved','paused'].includes(c.state);
 useEffect(()=>{if(!dirty){setName(c.name);setContext(c.businessContext??"");}},[c.name,c.businessContext,dirty]);
 return <>
  <form className="campaign-context" onSubmit={event=>{event.preventDefault();void action.run(async key=>{update(await api.editDraft(c.id,{expectedRevision:c.revision,name:name.trim(),businessContext:context.trim()||null,clientRequestId:key}));setDirty(false);return "Contexto salvo. Prepare as empresas novamente quando o público mudar.";});}}>
   <div className="prospecting-fields"><label>Nome da campanha<input required maxLength={120} disabled={!editable} value={name} onChange={event=>{setName(event.target.value);setDirty(true);}}/></label><label>Contexto das empresas<textarea aria-label="Contexto das empresas" rows={3} maxLength={4000} disabled={!editable} value={context} onChange={event=>{setContext(event.target.value);setDirty(true);}}/></label></div>
   <p>Ofertas: catálogo vigente da Zyon. A IA usa o contexto da campanha e os planos atuais para conversar.</p>
   {editable&&<Button type="submit" disabled={!dirty||!name.trim()||action.disabled}>Salvar contexto</Button>}{action.feedback}
  </form>
  {dirty&&<p role="status">Salve o contexto antes de preparar empresas ou revisar o envio.</p>}
  <Companies {...props} refresh={refreshWorkspace} disabled={!editable||dirty||action.disabled}/>
  <CampaignMessage {...props} channel={channel} disabled={!editable||dirty||action.disabled}/>
  <SendSetup {...props} refresh={refreshWorkspace} channel={channel} disabled={!editable||dirty||action.disabled} dirty={sendDirty} onDirty={setSendDirty}/>
  <section className="campaign-step"><h3>Atividade</h3><p>{c.recipientCount} destinatários preparados. Uma tentativa, aceitação pela Meta e entrega são estados diferentes.</p><Button onClick={()=>navigate({area:"campaigns",id:c.id})}>Ver destinatários e resultados</Button><Button onClick={refreshWorkspace}>Atualizar campanha</Button></section>
 </>;
}
function CampaignMessage(props:DraftProps & {disabled:boolean;channel:ChannelResource}){
 return <section className="campaign-step"><h3>Mensagem inicial</h3><p className="campaign-message-body">{props.campaign.message??"Selecione uma mensagem abaixo. Você pode preparar o rascunho antes de conectar o número."}</p><TemplateManager {...props} embedded bindingAvailable={!!props.channel.data?.binding} bindingState={!props.channel.data?(props.channel.error?'unavailable':'loading'):props.channel.data.binding?'connected':'absent'} refreshChannel={props.channel.reload} scope={props.campaign.id} selectedBody={props.campaign.message} locked={props.disabled} choose={async(draft,key)=>{props.update(await props.api.editDraft(props.campaign.id,{expectedRevision:props.campaign.revision,message:draft.body,template:null,clientRequestId:key}));}}/></section>;
}
function Companies(props:DraftProps & {disabled:boolean}){
 const {api,campaign:c,onSessionExpired,navigate,disabled,update,planning,planned}=props;
 const [cursor,setCursor]=useState<string>();
 const load=useCallback((s:AbortSignal)=>api.campaignCompanies(c.id,cursor,s),[api,c.id,c.revision,cursor]);
 const companies=useResource(load,onSessionExpired);
 const action=useAction(props,"campaign-companies."+c.id,()=>{companies.reload();props.refresh();});
 return <section className="campaign-step"><h3>Empresas</h3>
  <p>Prepare pelo contexto ou adicione empresas pela busca. A seleção usa uma base fixa e não concede opt-in aos contatos.</p>
  <div className="prospecting-actions"><Button disabled={disabled||action.disabled||!c.businessContext} onClick={()=>void action.run(async key=>{
   const source=(await api.readiness()).source;if(source.status!=="current"||!source.value?.snapshotId||source.value.state!=="published")throw new PlatformApiError(503,"source_unavailable");
   const job=await api.prepareContext(c.id,{expectedRevision:c.revision,snapshotId:c.directorySnapshotId??source.value.snapshotId,clientRequestId:key});planned(job);
   update(await api.draft(c.id));companies.reload();return job.state==="completed"?"Empresas preparadas pelo contexto.":planningReasons[job.errorCode??""]??"Preparação em andamento.";
  })}>Preparar empresas pelo contexto</Button><Button onClick={()=>navigate({area:"companies"})}>Buscar e adicionar empresas</Button></div>
  {planning?.campaignId===c.id&&<p role="status">{planning.state==="completed"?(planning.mode==="rules"?"Pesquisa por atividade e estado, sem chamada de IA.":"Público interpretado por IA e validado na base oficial."):['pending','processing'].includes(planning.state)?"Preparando empresas…":planningReasons[planning.errorCode??""]??"Preparação pendente. Revise o contexto e as configurações."}</p>}
  {action.feedback}
  {!companies.data?<ReadState {...companies}/>:<><p>{companies.data.count.toLocaleString('pt-BR')} empresas · {companies.data.manualCount} adicionadas manualmente</p>
   {!companies.data.count&&<p>O público ainda está vazio. Informe atividade e região ou escolha empresas na busca.</p>}
   {!!companies.data.items.length&&<div className="campaign-company-list" role="region" aria-label="Empresas da campanha" tabIndex={0}>{companies.data.items.map(company=><div key={company.cnpj} className="prospecting-row"><div><strong>{company.legalName}</strong><small>{company.cnpj} · {company.uf??"UF não informada"}</small></div><Button disabled={disabled||action.disabled} onClick={()=>void action.run(async key=>{const result=await api.removeCampaignCompanies(c.id,{expectedRevision:c.revision,snapshotId:company.snapshotId,cnpjs:[company.cnpj],clientRequestId:key});update(result.campaign);companies.reload();return "Empresa removida deste público.";})}>Remover {company.cnpj}</Button></div>)}</div>}
   <div className="prospecting-actions">{cursor&&<Button onClick={()=>setCursor(undefined)}>Primeira página de empresas</Button>}{companies.data.nextCursor&&<Button onClick={()=>setCursor(companies.data!.nextCursor!)}>Próximas empresas</Button>}<Button onClick={()=>{companies.reload();props.refresh();}}>Atualizar empresas</Button></div>
  </>}
 </section>;
}
function SendSetup(props:DraftProps & {disabled:boolean;dirty:boolean;onDirty:(v:boolean)=>void;channel:ChannelResource}){
 const {api,campaign:c,onSessionExpired,update,refresh,navigate,disabled,dirty,onDirty}=props;
 const sender=props.channel;
 const config=useResource(useCallback((s:AbortSignal)=>api.config(s),[api]),onSessionExpired);
 const readiness=useResource(useCallback((s:AbortSignal)=>sender.data?api.readiness(s):Promise.resolve(null),[api,sender.data]),onSessionExpired);
 const [daily,setDaily]=useState(c.limits?.dailyRecipients.toString()??""),[budget,setBudget]=useState(c.limits?(c.limits.budget.amountCents/100).toFixed(2):"");
 const [window,setWindow]=useState<ProspectingSendWindow>(c.sendWindow??{timezone:"America/Sao_Paulo",weekdays:[1,2,3,4,5],start:"09:00",end:"18:00"});
 const action=useAction(props,"campaign-send."+c.id,refresh);
 const load=useCallback((s:AbortSignal)=>c.selectionId?api.selection(c.id,c.selectionId,s):Promise.resolve(null),[api,c.id,c.selectionId]);
 const selection=useResource(load,onSessionExpired);
 useEffect(()=>{if(c.state!=="freezing")return;const timer=setTimeout(()=>{refresh();selection.reload();},2000);return ()=>clearTimeout(timer);},[c.state,selection.data,refresh,selection.reload]);
 let amount=0;try{amount=Number(cents(budget));}catch{/* Keep incomplete amounts unsaved. */}
 const valid=Number.isInteger(Number(daily))&&Number(daily)>0&&Number.isSafeInteger(amount)&&amount>0&&window.weekdays.length>0&&window.start<window.end;
 const ready=sender.data?.status==="ready"&&!!sender.data.binding&&!sender.data.blockers.length&&config.data?.workersRunning&&config.data.dispatchMode!=="disabled"&&config.data.modelMode!=="disabled"&&readiness.data?.channel.status==='current'&&readiness.data.channel.value?.status==='ready'&&readiness.data?.knowledge.status==="current"&&!!readiness.data.knowledge.value?.activePublications;
 const compatibleMessage=!!c.message&&sender.data?.templates.some(t=>t.status==='APPROVED'&&t.category==='MARKETING'&&t.requiresParameters===false&&t.previewText===c.message&&t.wabaId===sender.data?.binding?.wabaId);
 const bindingCurrent=!!sender.data?.binding&&c.senderBindingId===sender.data.binding.id&&c.senderVersion===sender.data.binding.version;
 const canPrepare=!disabled&&!dirty&&!!c.directorySnapshotId&&!!c.limits&&!!c.sendWindow&&bindingCurrent&&compatibleMessage&&ready;
 return <section className="campaign-step"><h3>Envio e revisão</h3>
  <form onChange={()=>onDirty(true)} onSubmit={event=>{event.preventDefault();if(!valid)return;void action.run(async key=>{let b=sender.data?.binding;if(!sender.data){try{b=(await api.sender()).binding;}catch{/* Limits remain saveable while the channel is unavailable. */}}update(await api.editDraft(c.id,{expectedRevision:c.revision,limits:{dailyRecipients:Number(daily),budget:{amountCents:amount,currency:"BRL"}},sendWindow:window,...(b?{senderBindingId:b.id,senderVersion:b.version}:{}),clientRequestId:key}));onDirty(false);sender.reload();return "Limites e janela salvos. Revise a mensagem e o público antes de aprovar.";});}}>
   <div className="prospecting-fields prospecting-fields--limits"><label>Destinatários por dia<input type="number" required min={1} max={2147483647} value={daily} onChange={event=>setDaily(event.target.value)} disabled={disabled}/></label><label>Orçamento total (R$)<input required inputMode="decimal" value={budget} onChange={event=>setBudget(event.target.value)} disabled={disabled}/></label><label>Início da janela<input type="time" value={window.start} onChange={event=>setWindow({...window,start:event.target.value})} disabled={disabled}/></label><label>Fim da janela<input type="time" value={window.end} onChange={event=>setWindow({...window,end:event.target.value})} disabled={disabled}/></label><label>Fuso de referência<input value={window.timezone} onChange={event=>setWindow({...window,timezone:event.target.value})} disabled={disabled}/></label></div>
   <fieldset disabled={disabled}><legend>Dias de envio</legend><div className="prospecting-actions">{['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map((label,index)=><label className="prospecting-check" key={label}><input type="checkbox" checked={window.weekdays.includes(index+1)} onChange={event=>setWindow({...window,weekdays:event.target.checked?[...window.weekdays,index+1]:window.weekdays.filter(d=>d!==index+1)})}/>{label}</label>)}</div></fieldset>
   <p>Os limites precisam ser definidos por você. Um follow-up após 48 horas da entrega exige ausência de resposta, opt-in e uma janela válida.</p>
   <Button type="submit" disabled={disabled||action.disabled||!valid}>Salvar configuração de envio</Button>
  </form>
  {!sender.data?(sender.error?<><p>Não foi possível verificar o canal. A campanha e as empresas continuam salvas.</p><Button onClick={sender.reload}>Verificar canal da Zyon</Button><ReadState {...sender}/></>:<p role="status" aria-busy="true">Consultando a configuração do canal…</p>):!sender.data.binding?<><p>Conecte o número próprio da Zyon no canal. Você já pode pesquisar empresas e preparar o texto.</p><Button onClick={()=>navigate({area:"channel"})}>Conectar número da Zyon</Button></>:<p>Número da Zyon: {sender.data.binding.displayPhoneNumber}. {sender.data.blockers.map(b=>blockers[b]).join(' · ')}</p>}
  {config.data?.dispatchMode==="disabled"&&<p>Os envios reais ainda precisam ser habilitados pela administração.</p>}
  {sender.data?.binding&&c.senderBindingId&&!bindingCurrent&&<p>O vínculo do número mudou. Salve a configuração de envio para revisar o número atual.</p>}
  {config.data?.modelMode==="disabled"&&<p>Habilite a IA comercial e sua cotação antes de iniciar a campanha.</p>}
  {config.data&&!config.data.workersRunning&&<p>O processamento automático precisa ser habilitado pela administração.</p>}
  {readiness.data&&(!readiness.data.knowledge.value?.activePublications||readiness.data.knowledge.status!=="current")&&<><p>Publique o conhecimento comercial revisado antes de iniciar conversas automáticas.</p><Button onClick={()=>navigate({area:"knowledge"})}>Revisar conhecimento comercial</Button></>}
  {(!config.data||!readiness.data)&&<p role="status" aria-busy={(!config.data&&!config.error)||(!!sender.data&&!readiness.data&&!readiness.error)}>A verificação de envio está pendente. Atualize a campanha para consultar as configurações.</p>}
  {dirty&&<p role="status">Salve a configuração de envio antes de preparar a revisão.</p>}
  {action.feedback}
  <Button disabled={!canPrepare||action.disabled} onClick={()=>void action.run(async key=>{await api.prepareCampaign(c.id,{expectedRevision:c.revision,clientRequestId:key});update(await api.draft(c.id));selection.reload();return "Preparando o público e a mensagem para revisão. Nenhum envio iniciado.";})}>Preparar revisão da campanha</Button>
  {selection.data&&<p>Público {selection.data.state==="complete"?"preparado":selection.data.state==="failed"?"com falha":"em preparação"} · {selection.data.companyCount} empresas · {selection.data.recipientCount} destinatários · {selection.data.missingEndpointCount} sem contato</p>}
  {selection.data?.eligibilityBlockers?.map(b=><p key={b.reason}>{blockers[b.reason]} · {b.recipients} destinatários</p>)}
  {c.state==="review_ready"&&<Button disabled={disabled||dirty||action.disabled||!ready||!c.audienceHash||selection.data?.state!=="complete"} onClick={()=>void action.run(async key=>{await api.approve(c.id,{expectedRevision:c.revision,audienceHash:c.audienceHash!,contentHash:c.contentHash!,clientRequestId:key});update(await api.draft(c.id));return "Revisão da campanha aprovada. A aprovação da Meta é consultada separadamente.";})}>Aprovar revisão da campanha</Button>}
  {c.state==="approved"&&<Button disabled={disabled||dirty||action.disabled||!ready} onClick={()=>void action.run(async key=>{await api.start(c.id,{expectedRevision:c.revision,clientRequestId:key});update(await api.draft(c.id));return "Campanha iniciada com as proteções de envio.";})}>Iniciar campanha</Button>}
 </section>;
}
