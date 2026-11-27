import {useId,useLayoutEffect,useRef,type ReactNode} from "react";
import {X} from "lucide-react";

export function ProspectingModal({title,description,busy=false,onClose,returnFocusId,children}:{title:string;description:string;busy?:boolean;onClose:()=>void;returnFocusId?:string;children:ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null),id=useId();
 useLayoutEffect(()=>{
  const node=dialog.current!;
  const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const overflow=document.documentElement.style.overflow;
  node.showModal();document.documentElement.style.overflow="hidden";
  return ()=>{node.close();document.documentElement.style.overflow=overflow;queueMicrotask(()=>{const target=opener?.isConnected?opener:returnFocusId?document.getElementById(returnFocusId):null;target?.focus({preventScroll:true});});};
 },[]);
 return <dialog ref={dialog} className="prospecting-modal prospecting-page" aria-labelledby={id+'-title'} aria-describedby={id+'-description'} aria-busy={busy} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
  <header className="prospecting-modal-heading"><div><h2 id={id+'-title'}>{title}</h2><p id={id+'-description'}>{description}</p></div><button type="button" className="icon-button" aria-label={'Fechar '+title.toLocaleLowerCase('pt-BR')} disabled={busy} onClick={onClose}><X size={20} aria-hidden="true"/></button></header>
  {children}
 </dialog>;
}
