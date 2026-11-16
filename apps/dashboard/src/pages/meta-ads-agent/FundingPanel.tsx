import { useRef, useState } from 'react';
import type { MetaAdsFundingDiagnosis } from '@zyon/shared-types';
import { money } from './presentation.js';
import './funding-panel.css';

function paymentDestination(value:string|null,accountId:string):string|null {
  try {
    if(!value||!/^\d+$/.test(accountId))return null;const url=new URL(value);
    if(url.protocol!=='https:'||url.hostname!=='business.facebook.com'||url.port||url.username||url.password||url.hash||url.pathname!=='/latest/billing_hub/payment_settings/')return null;
    for(const key of ['payment_account_id','asset_id'])if(url.searchParams.getAll(key).length!==1||url.searchParams.get(key)!==accountId)return null;
    return url.href;
  }catch{return null;}
}
export interface FundingPanelProps {
  account: {id:string;name:string}|null; diagnosis?:MetaAdsFundingDiagnosis|null;
  loading?:boolean; busy?:boolean; error?:string; onRefresh:()=>void|Promise<void>;
}
export function FundingPanel({account,diagnosis,loading,busy,error,onRefresh}:FundingPanelProps) {
  const lock=useRef(false);const [refreshing,setRefreshing]=useState(false),[refreshError,setRefreshError]=useState('');
  const snapshot=account&&diagnosis?.snapshot?.accountId===account.id?diagnosis.snapshot:null;
  const current=diagnosis?.snapshot&&!snapshot?null:diagnosis;
  const url=snapshot?paymentDestination(snapshot.paymentUrl,snapshot.accountId):null;
  async function refresh(){if(lock.current||busy)return;lock.current=true;setRefreshing(true);setRefreshError('');try{await onRefresh();}catch{setRefreshError('Não foi possível atualizar. Consulte os pagamentos na Meta e tente verificar novamente.');}finally{lock.current=false;setRefreshing(false);}}
  return <section className="mga-panel mga-funding" aria-label="Verba dos anúncios"><h2>Verba dos anúncios</h2>
    <p>O investimento em anúncios é pago diretamente à Meta. A assinatura da Zyon e os créditos de imagens não incluem essa verba.</p>
    {!account?<p>Conecte e selecione sua conta de anúncios para consultar os pagamentos.</p>:<><p><strong>{account.name}</strong> · Conta {account.id}</p>
      {loading&&<p role="status">Consultando pagamentos da conta…</p>}
      {current?.status==='blocked'&&<p role="alert"><strong>Publicação bloqueada.</strong> Resolva a restrição financeira na Meta antes de publicar. A ajuda e a consulta continuam disponíveis.</p>}
      {current?.message&&<p>{current.message}</p>}
      {snapshot?.billingType==='prepaid'&&<p>Pré-paga: adicione fundos na Meta para financiar os anúncios. As opções e a confirmação aparecem na sua conta da Meta.</p>}
      {snapshot?.billingType==='postpaid'&&<p>Pós-paga: confira seu método de pagamento e os valores devidos na Meta. Esse modelo não exige recarga pré-paga.</p>}
      {(!snapshot||snapshot.billingType==='unknown')&&<p>Não foi possível confirmar o tipo de cobrança. Confira as condições e opções de pagamento no painel da Meta; nenhum saldo será presumido.</p>}
      {snapshot&&<><dl className="mga-ledger">
        <div><dt>Método de pagamento</dt><dd>{snapshot.paymentMethod==='present'?'Cadastrado':snapshot.paymentMethod==='missing'?'Não encontrado':'Indisponível'}</dd></div>
        {snapshot.billingType==='prepaid'&&<div><dt>Saldo pré-pago disponível</dt><dd>{snapshot.currency?money(snapshot.prepaidAvailableCents,snapshot.currency):'Indisponível'}</dd></div>}
        <div><dt>Valor devido à Meta</dt><dd>{snapshot.currency?money(snapshot.amountDueCents,snapshot.currency):'Indisponível'}</dd></div>
      </dl><small>Consulta em <time dateTime={snapshot.checkedAt}>{new Date(snapshot.checkedAt).toLocaleString('pt-BR',{timeZoneName:'short'})}</time> · Fonte: {snapshot.source}</small></>}
      {!!current?.nextSteps.length&&<ul>{current.nextSteps.map(step=><li key={step}>{step}</li>)}</ul>}
      <div className="mga-actions">{url?<a className="mga-payment-link" href={url} target="_blank" rel="noopener noreferrer">Abrir pagamentos na Meta</a>:<button type="button" disabled>Acesso aos pagamentos indisponível</button>}
        <button type="button" className="mga-secondary" disabled={loading||busy||refreshing} onClick={()=>void refresh()}>{refreshing?'Verificando…':'Verificar novamente'}</button></div>
      <small>O pagamento não é confirmado por este botão. Verificar novamente apenas consulta a conta; não adiciona saldo nem compra créditos.</small>
    </>}
    {(error||refreshError)&&<p role="alert">{error||refreshError}</p>}
  </section>;
}
