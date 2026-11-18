import { useRef, useState } from 'react';
import type { MetaAdsFundingDiagnosis } from '@zyon/shared-types';
import { money,useAction } from './presentation.js';
import './funding-panel.css';
import { CreditCard, ExternalLink } from 'lucide-react';

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
  showCostNotice?:boolean;compact?:boolean;
}
export function FundingPanel({account,diagnosis,loading,busy,error,onRefresh,showCostNotice=true,compact=false}:FundingPanelProps) {
  const lock=useRef(false);const [refreshing,setRefreshing]=useState(false),[refreshError,setRefreshError]=useState('');
  const feedback=useAction();
  const snapshot=account&&diagnosis?.snapshot?.accountId===account.id?diagnosis.snapshot:null;
  const current=diagnosis?.snapshot&&!snapshot?null:diagnosis;
  const url=snapshot?paymentDestination(snapshot.paymentUrl,snapshot.accountId):null;
  async function refresh(){if(lock.current||busy)return;lock.current=true;setRefreshing(true);setRefreshError('');try{await onRefresh();feedback.notify('success','Consulta de pagamentos atualizada. Confira a situação da conta.');}catch{const message='Não foi possível atualizar. Consulte os pagamentos na Meta e tente verificar novamente.';setRefreshError(message);feedback.notify('error',message);}finally{lock.current=false;setRefreshing(false);}}
  return <section className="mga-panel mga-funding" aria-label="Verba dos anúncios">
    <div className="mga-funding-heading"><CreditCard size={18} aria-hidden="true"/><div><h2>Verba dos anúncios</h2>{account&&<small className={compact?'mga-funding-status':undefined}>{compact?(snapshot?.billingType==='prepaid'?'Pré-paga · Adicione fundos na Meta':snapshot?.billingType==='postpaid'?'Pós-paga · Confira o método de pagamento':'Pagamentos não confirmados'):`${account.name} · Conta ${account.id}`}</small>}</div></div>
    {showCostNotice&&<p className="mga-funding-separation">Sua assinatura da Zyon não inclui o investimento dos anúncios. Esse valor é pago diretamente à Meta.</p>}
    {!account?<p>Conecte e selecione sua conta de anúncios para consultar os pagamentos.</p>:<>
      {loading&&<p role="status">Consultando pagamentos da conta…</p>}
      {current?.status==='blocked'&&<p className="mga-funding-block" role="alert"><strong>Publicação bloqueada.</strong> Resolva a pendência financeira na Meta.</p>}
      <div className="mga-actions">{url?<a className="mga-payment-link" href={url} target="_blank" rel="noopener noreferrer">Abrir pagamentos na Meta<ExternalLink size={14} aria-hidden="true"/></a>:<button type="button" disabled>Acesso aos pagamentos indisponível</button>}
        <button type="button" className="mga-secondary" disabled={loading||busy||refreshing} onClick={()=>void refresh()}>{refreshing?'Verificando…':'Verificar novamente'}</button></div>
      <details className="mga-funding-details mga-disclosure"><summary>Detalhes dos pagamentos</summary>
      {snapshot&&<><dl className="mga-ledger">
        {compact&&<div><dt>Conta consultada</dt><dd>{snapshot.accountName} · Conta {snapshot.accountId}</dd></div>}
        <div><dt>Método de pagamento</dt><dd>{snapshot.paymentMethod==='present'?'Cadastrado':snapshot.paymentMethod==='missing'?'Não encontrado':'Indisponível'}</dd></div>
        {snapshot.billingType==='prepaid'&&<div><dt>Saldo pré-pago disponível</dt><dd>{snapshot.currency?money(snapshot.prepaidAvailableCents,snapshot.currency):'Indisponível'}</dd></div>}
        <div><dt>Valor devido à Meta</dt><dd>{snapshot.currency?money(snapshot.amountDueCents,snapshot.currency):'Indisponível'}</dd></div>
      </dl><small>Consulta em <time dateTime={snapshot.checkedAt}>{new Date(snapshot.checkedAt).toLocaleString('pt-BR',{timeZoneName:'short'})}</time> · Dados consultados na Meta</small></>}
      {current?.message&&<p>{current.message}</p>}
      <details className="mga-payment-guidance mga-inline-details mga-disclosure"><summary>Ajuda sobre pagamentos</summary>
      <ol><li>Abra os pagamentos na Meta e confira a conta selecionada.</li><li>Se a conta usa saldo antecipado, escolha Adicionar fundos. Se usa cobrança automática, confira a forma de pagamento.</li><li>Depois volte aqui e use Verificar novamente para consultar a situação.</li></ol>
      <p>Os créditos de imagens também não incluem a verba de anúncios.</p>
      {current?.status==='unknown'&&<p>Não foi possível verificar os pagamentos desta conta. Confira as informações no painel da Meta.</p>}
      {snapshot?.billingType==='prepaid'&&<p>Pré-paga: adicione fundos na Meta para financiar os anúncios. As opções e a confirmação aparecem na sua conta da Meta.</p>}
      {snapshot?.billingType==='postpaid'&&<p>Pós-paga: confira seu método de pagamento e os valores devidos na Meta. Esse modelo não exige recarga pré-paga.</p>}
      {(!snapshot||snapshot.billingType==='unknown')&&<p>Não foi possível confirmar o tipo de cobrança. Confira as condições e opções de pagamento no painel da Meta; nenhum saldo será presumido.</p>}
      {!!current?.nextSteps.length&&<ul>{current.nextSteps.map(step=><li key={step}>{step}</li>)}</ul>}
      <small>O pagamento não é confirmado por este botão. Verificar novamente apenas consulta a conta; não adiciona saldo nem compra créditos.</small>
      </details>
      </details>
    </>}
    {account&&(error||refreshError)&&<p role="alert">{error||refreshError}</p>}
  </section>;
}
