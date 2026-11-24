import {useCallback,useEffect,useRef,useState} from "react";
import type {PlatformProspectTemplateDraft} from "@zyon/shared-types";
import {parseProspectingMaxPrice,prospectingMaxPriceInput} from "@zyon/shared-types";
import {PlatformApiError} from "../../lib/api.js";
import {Button,ReadState,dateTime,useAction,useResource,type PageProps} from "./screen-controls.js";
export const templateStates:Record<PlatformProspectTemplateDraft['state'],string>={draft:"Rascunho · Não enviado à Meta",submitting:"Envio à Meta em andamento",submission_unknown:"Resultado do envio à Meta desconhecido",PENDING:"Em análise pela Meta",APPROVED:"Aprovado pela Meta",REJECTED:"Rejeitado pela Meta",PAUSED:"Pausado pela Meta",DISABLED:"Desativado pela Meta"};
const templateReasons:Record<string,string>={create_outcome_unknown:"A Meta ainda não confirmou o resultado. Atualize o estado antes de tentar outro envio.",template_content_mismatch:"O texto observado na Meta difere deste rascunho. Esta mensagem não pode ser usada no envio.",template_pricing_mismatch:"O preço observado na Meta difere deste rascunho. Prepare uma mensagem com o teto correto antes de revisar o envio.",max_price_agreement_required:"O acordo do Max Price precisa ser aceito pelo responsável na Meta. O rascunho continua salvo.",max_price_unavailable:"Não foi possível confirmar o Max Price em reais nesta conta. Confira o canal e tente atualizar novamente.",template_not_found:"A mensagem ainda não foi encontrada na Meta. Atualize o estado novamente antes de reenviar."};
export function TemplateManager(props:PageProps & {bindingAvailable:boolean;bindingState?:"loading"|"unavailable"|"absent"|"connected";scope?:string;embedded?:boolean;selectedBody?:string|null;selectedTemplateId?:string|null;locked?:boolean;refreshChannel?:()=>void;choose?:(draft:PlatformProspectTemplateDraft,key:string)=>Promise<void>}){
 const {api,onSessionExpired,bindingAvailable,navigate,selectedBody,locked,choose}=props;
 const resource=useResource(useCallback((s:AbortSignal)=>api.templates(s),[api]),onSessionExpired);
 const [observed,setObserved]=useState<PlatformProspectTemplateDraft[]>([]),[open,setOpen]=useState(false),[name,setName]=useState("zyon_primeiro_contato"),[body,setBody]=useState("Olá! Aqui é a equipe da Zyon. Podemos conversar sobre vendas e atendimento para sua loja? Se não quiser receber mensagens, avise por aqui.");
 const [pricingMode,setPricingMode]=useState("standard"),[priceInput,setPriceInput]=useState("");
 let maxPrice=null;try{if(pricingMode==="max_price")maxPrice=parseProspectingMaxPrice(priceInput);}catch{/* The incomplete price remains unsaved. */}
 const selected=(d:PlatformProspectTemplateDraft)=>props.selectedTemplateId?d.id===props.selectedTemplateId:!d.maxPrice&&selectedBody===d.body;
 const mismatched=(d:PlatformProspectTemplateDraft)=>["template_content_mismatch","template_pricing_mismatch"].includes(d.reason??"");
 const trigger=useRef<HTMLButtonElement>(null),input=useRef<HTMLInputElement>(null),restoreFocus=useRef(false);
 const action=useAction(props,"templates."+(props.scope??"channel"),()=>{resource.reload();props.refreshChannel?.();});
 const denied=resource.error instanceof PlatformApiError&&[401,403].includes(resource.error.status);
 const bindingState=props.bindingState??(bindingAvailable?'connected':'absent');
 useEffect(()=>{if(resource.data)setObserved(resource.data);},[resource.data]);
 useEffect(()=>{if(open)input.current?.focus();},[open]);
 useEffect(()=>{if(!open&&!action.disabled&&restoreFocus.current){restoreFocus.current=false;trigger.current?.focus();}},[open,action.disabled]);
 function close(){restoreFocus.current=true;setOpen(false);}
 function update(d:PlatformProspectTemplateDraft){setObserved(list=>list.some(t=>t.id===d.id)?list.map(t=>t.id===d.id?d:t):[d,...list]);resource.reload();props.refreshChannel?.();}
 return <section className="campaign-step template-manager" aria-label="Mensagens de prospecção" onKeyDown={event=>{if(event.key==="Escape"&&open){event.stopPropagation();close();}}}>
  {!props.embedded&&<><h3>Mensagens de prospecção</h3><p>Revise o texto completo. Salvar um rascunho e aprovar a revisão da campanha são etapas separadas da aprovação da Meta.</p></>}
  {action.feedback}
  <button ref={trigger} type="button" className="button button--secondary" aria-expanded={open} disabled={denied||action.disabled} onClick={()=>setOpen(v=>!v)}>Preparar mensagem</button>
  {open&&<form onSubmit={event=>{event.preventDefault();if(pricingMode==="max_price"&&!maxPrice)return;void action.run(async key=>{const d=await api.createTemplate({name:name.trim(),language:"pt_BR",body:body.trim(),...(maxPrice?{maxPrice}:{}),clientRequestId:key});update(d);close();return "Rascunho salvo. Ainda não enviado à Meta.";});}}>
   <label>Nome da mensagem<input ref={input} required pattern="[_a-z][_a-z0-9]{1,99}" maxLength={100} value={name} onChange={event=>setName(event.target.value)}/></label>
   <label>Texto da mensagem<textarea aria-label="Texto da mensagem" required rows={5} maxLength={1024} value={body} onChange={event=>setBody(event.target.value)}/></label>
   <div className="prospecting-fields template-pricing-fields"><label>Preço da mensagem<select value={pricingMode} onChange={event=>setPricingMode(event.target.value)}><option value="standard">Tarifa padrão da Meta</option><option value="max_price">Definir preço máximo · Max Price</option></select></label>
    {pricingMode==="max_price"&&<label>Teto por entrega (R$)<input required inputMode="decimal" placeholder="Informe o valor" value={priceInput} onChange={event=>setPriceInput(event.target.value)} aria-describedby="template-price-help"/></label>}
   </div>
   {pricingMode==="max_price"&&<p id="template-price-help">Um teto menor pode reduzir as entregas. Você também define o orçamento total na campanha. A economia depende do custo informado pela Meta.</p>}
   <p>Sugestão de texto em português. Revise antes de salvar. Use texto estático, sem parâmetros ou mídia.</p><p className="campaign-message-body" aria-label="Prévia do rascunho">{body}</p>
   <div className="prospecting-actions"><Button primary type="submit" disabled={denied||action.disabled||!body.trim()||pricingMode==="max_price"&&!maxPrice||!/^[a-z_][a-z_0-9]{1,99}$/.test(name)}>Salvar rascunho da mensagem</Button><Button onClick={close}>Cancelar mensagem</Button></div>
  </form>}
  {bindingState==='loading'&&<p role="status" aria-busy="true">Consultando o número da Zyon…</p>}
  {bindingState==='unavailable'&&<><p>Não foi possível conferir o número da Zyon. O rascunho continua salvo; atualize as mensagens para verificar a conexão.</p><Button onClick={props.refreshChannel}>Verificar número da Zyon</Button></>}
  {bindingState==='absent'&&<><p>Conecte o número próprio da Zyon para enviar uma mensagem à análise da Meta. O rascunho pode ser preparado agora.</p><Button onClick={()=>navigate({area:"channel"})}>Configurar número da Zyon</Button></>}
  {!resource.data&&<ReadState {...resource}/>}<Button onClick={()=>{resource.reload();props.refreshChannel?.();}}>Atualizar mensagens</Button>
  {resource.data&&!observed.length&&<p>Nenhuma mensagem de prospecção preparada. Crie um rascunho para ver o texto e acompanhar a análise da Meta.</p>}
  {!!observed.length&&<div className="prospecting-template-list" role="region" aria-label="Mensagens disponíveis" tabIndex={0}>{observed.map(d=><article className="prospecting-template" key={d.id} aria-label={"Mensagem "+d.name}>
   <header><strong>{d.name}</strong><p>{d.reason==='template_content_mismatch'?(d.state==='APPROVED'?'Conteúdo diferente do aprovado na Meta':'Conteúdo diferente do observado na Meta'):templateStates[d.state]} · {d.language} · MARKETING</p>{d.reason==='template_content_mismatch'&&<p>Estado do template na Meta: {templateStates[d.state]}. O texto salvo abaixo não está aprovado para envio.</p>}</header>
   <p className="campaign-message-body">{d.body}</p>
   <p className="template-price">{d.maxPrice?"Max Price · teto de R$ "+prospectingMaxPriceInput(d.maxPrice)+" por entrega":"Tarifa padrão da Meta"}</p>
   {d.reason&&<p role="status">{templateReasons[d.reason]??"Motivo informado pela Meta: "+d.reason}</p>}
   {d.observedAt&&<p>Estado consultado em {dateTime(d.observedAt)}.</p>}
   {selected(d)&&<p>Texto selecionado nesta campanha.</p>}
   <div className="prospecting-actions">
    {choose&&<Button disabled={locked||action.disabled||!resource.data||selected(d)||mismatched(d)} onClick={()=>void action.run(async key=>{await choose(d,key);return "Texto selecionado. Confira o estado da Meta antes de preparar o envio.";})}>Usar {d.name} nesta campanha</Button>}
    {d.state==="draft"?<Button disabled={!bindingAvailable||action.disabled||!resource.data} onClick={()=>void action.run(async key=>{const result=await api.submitTemplate(d.id,{expectedRevision:d.revision,clientRequestId:key});update(result);return templateStates[result.state];})}>Enviar {d.name} à Meta</Button>:<Button disabled={!bindingAvailable||action.disabled||!resource.data} onClick={()=>void action.run(async key=>{const result=await api.syncTemplate(d.id,{expectedRevision:d.revision,clientRequestId:key});update(result);return templateStates[result.state];})}>{d.state==="submission_unknown"?"Confirmar resultado de "+d.name:"Atualizar estado de "+d.name+" na Meta"}</Button>}
   </div>
  </article>)}</div>}
 </section>;
}
