import {useEffect,useRef,useState} from 'react';
import type {MetaAdsCampaignNoticeContact,MetaAdsCampaignNoticeContactInput} from '@zyon/shared-types';
import type {CampaignApprovalApi} from './api.js';
import {formatWhatsAppPhone,maskPhone} from '../../utils/masks.js';
import {showToast} from '../../components/Toast.js';
const canonicalPhone=(value:string)=>value.replace(/[()\s-]/g,'');
function maskedPhone(value:string){
  const canonical=canonicalPhone(value);
  if(!/^\+55\d{0,11}$/.test(canonical))return value;
  const national=canonical.slice(3);
  return national.length>=10?formatWhatsAppPhone(canonical):`+55${national?' '+maskPhone(national):''}`;
}
interface Props{merchantId:string;api:Pick<CampaignApprovalApi,'contact'|'saveContact'>;channelAvailable?:boolean;}
export function CampaignNoticePreferences(props:Props){return <Preferences key={props.merchantId} {...props}/>;}
function Preferences({api,channelAvailable}:Props){
  const [contact,setContact]=useState<MetaAdsCampaignNoticeContact|null>(null),[phone,setPhone]=useState(''),[consented,setConsented]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('');
  const alive=useRef(true),lock=useRef(false);
  function apply(value:MetaAdsCampaignNoticeContact){setContact(value);setPhone(maskedPhone(value.phoneNumber??''));setConsented(value.consented);}
  async function load(notify=false){
    if(lock.current)return;lock.current=true;setBusy(true);setError('');setMessage('');
    try{const value=await api.contact();if(alive.current){apply(value);if(notify)showToast('success','Contato atualizado.');}}catch{if(alive.current){const message='Não foi possível consultar o contato. Atualize antes de salvar.';setError(message);if(notify)showToast('error',message);}}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;};},[api]);
  async function save(revoke=false){
    if(lock.current||!contact||error)return;
    const input:MetaAdsCampaignNoticeContactInput={phoneNumber:revoke?contact.phoneNumber:canonicalPhone(phone)||null,consented:!revoke&&consented,expectedVersion:contact.version};
    lock.current=true;setBusy(true);setMessage('');
    try{const value=await api.saveContact(input);if(alive.current){apply(value);const message=value.consented?'Contato salvo. Novos avisos usarão esta configuração.':'Avisos no WhatsApp desativados. Os avisos continuam no painel.';setMessage(message);showToast('success',message);}}
    catch{if(alive.current){const message='Não foi possível confirmar a alteração. Atualize o contato antes de tentar novamente.';setError(message);showToast('error',message);}}
    finally{lock.current=false;if(alive.current)setBusy(false);}
  }
  const valid=/^\+[1-9]\d{7,14}$/.test(canonicalPhone(phone));
  return <section className="mga-settings-section" aria-label="Avisos de campanhas"><h2>Avisos de campanhas</h2><p>Receba campanhas prontas para aprovação no contato administrativo, pelo WhatsApp conectado da loja.</p>
    <form onSubmit={event=>{event.preventDefault();if(valid&&consented)void save();}}>
      <label htmlFor="campaign-notice-phone">WhatsApp do administrativo</label><input id="campaign-notice-phone" type="tel" autoComplete="tel" placeholder="+55 (11) 99999-9999" value={phone} disabled={busy||!contact} onChange={event=>{setPhone(maskedPhone(event.target.value));setConsented(false);setMessage('');}}/><small>Inclua o código do país (+55 no Brasil) e o DDD. Use um número diferente do WhatsApp da loja.</small>
      <label className="mga-checkbox"><input type="checkbox" checked={consented} disabled={busy||!contact} onChange={event=>setConsented(event.target.checked)}/>Autorizo receber avisos de aprovação neste número.</label>
      <div className="mga-actions"><button type="submit" disabled={busy||!contact||!valid||!consented||!!error}>Salvar contato</button><button type="button" className="mga-secondary" disabled={busy} onClick={()=>void load(true)}>Atualizar contato</button>{contact?.consented&&<button type="button" className="mga-secondary" disabled={busy||!!error} onClick={()=>void save(true)}>Revogar avisos no WhatsApp</button>}</div>
    </form>
    {channelAvailable===false&&<p role="status">Conecte o WhatsApp da loja para habilitar este canal. Os avisos continuam no painel.</p>}
    <small>O WhatsApp depende da conexão e de um modelo de mensagem aprovado pela Meta. A aceitação do envio não confirma entrega.</small>
    {busy&&<p role="status">Atualizando contato…</p>}{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
