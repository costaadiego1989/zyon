import {useCallback,useEffect,useRef,useState} from "react";
import type {ProspectCampaignDraft} from "@zyon/shared-types";
import {Button,ReadState,useAction,useResource,type PageProps} from "./screen-controls.js";
export function CampaignCompanyTransfer(props:PageProps & {snapshotId:string;cnpjs:string[];disabled:boolean}){
 const {snapshotId,cnpjs,disabled}=props;
 const [open,setOpen]=useState(false),[version,setVersion]=useState(0);
 const trigger=useRef<HTMLButtonElement>(null);
 function close(){setOpen(false);trigger.current?.focus();}
 return <>
  <button ref={trigger} type="button" className="button button--primary campaign-transfer-trigger" disabled={disabled||!cnpjs.length} aria-expanded={open} onClick={()=>setOpen(v=>!v)}>Adicionar à campanha</button>
  {open&&<Transfer key={snapshotId+":"+version} {...props} close={close} refresh={()=>setVersion(v=>v+1)}/>}
 </>;
}
function Transfer(props:PageProps & {snapshotId:string;cnpjs:string[];disabled:boolean;close:()=>void;refresh:()=>void}){
 const {api,snapshotId,cnpjs,disabled,close,refresh,navigate,onSessionExpired}=props;
 const [cursor,setCursor]=useState<string>(),[choice,setChoice]=useState(""),[name,setName]=useState("");
 const [created,setCreated]=useState<ProspectCampaignDraft|null>(null),[updated,setUpdated]=useState<ProspectCampaignDraft|null>(null);
 const input=useRef<HTMLSelectElement>(null);
 const load=useCallback((s:AbortSignal)=>api.drafts(cursor,s),[api,cursor]);
 const result=useResource(load,onSessionExpired);
 useEffect(()=>{if(result.data)input.current?.focus();},[result.data]);
 const action=useAction(props,"company-transfer."+snapshotId,refresh);
 const compatible=result.data?.items.filter(c=>['draft','review_ready','approved','paused'].includes(c.state)&&(!c.directorySnapshotId||c.directorySnapshotId===snapshotId))??[];
 const selected=updated?.id===choice?updated:compatible.find(c=>c.id===choice);
 return <section className="campaign-transfer" aria-label="Adicionar empresas à campanha" onKeyDown={event=>{if(event.key==="Escape"){event.stopPropagation();close();}}}>
  <h3>Adicionar {cnpjs.length} empresa(s) à campanha</h3><p>A seleção usa a mesma base da busca. As empresas já incluídas serão mantidas sem duplicação.</p>
  {action.feedback}
  {!result.data?<ReadState {...result}/>:<>
   <div className="prospecting-actions"><label>Campanha existente<select ref={input} aria-label="Campanha existente" value={choice} onChange={event=>setChoice(event.target.value)}><option value="">Selecionar campanha</option>{compatible.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
    <Button disabled={disabled||!selected||action.disabled||!cnpjs.length} onClick={()=>void action.run(async key=>{const r=await api.addCampaignCompanies(selected!.id,{expectedRevision:selected!.revision,snapshotId,cnpjs:[...cnpjs],clientRequestId:key});setUpdated(r.campaign);return `${r.added} adicionada(s) e ${r.existing} já existente(s) nesta campanha.`;})}>Adicionar à campanha escolhida</Button>
   </div>
   {!compatible.length&&<p>Não há rascunho compatível nesta página. Crie uma campanha com a seleção abaixo.</p>}
   <div className="prospecting-actions">{cursor&&<Button onClick={()=>{setCursor(undefined);setChoice("");}}>Primeiras campanhas</Button>}{result.data.nextCursor&&<Button onClick={()=>{setCursor(result.data!.nextCursor!);setChoice("");}}>Outras campanhas</Button>}<Button onClick={()=>{result.reload();setUpdated(null);}}>Atualizar campanhas</Button></div>
  </>}
  <form onSubmit={event=>{event.preventDefault();void action.run(async key=>{const c=await api.createDraft({name:name.trim(),companies:{snapshotId,cnpjs:[...cnpjs]},clientRequestId:key});setCreated(c);return `Campanha criada com ${c.manualCompanyCount} empresa(s). Nenhuma mensagem enviada.`;});}}>
   <label>Nome da nova campanha<input required maxLength={120} value={name} onChange={event=>setName(event.target.value)}/></label><Button primary type="submit" disabled={disabled||action.disabled||!name.trim()||!cnpjs.length||!!created}>Criar com empresas selecionadas</Button>
  </form>
  {(created||updated)&&<Button onClick={()=>navigate({area:"campaigns",id:(created??updated)!.id,filters:{view:"edit"}})}>Abrir campanha</Button>}
  <Button onClick={close}>Fechar seleção de campanha</Button>
 </section>;
}
