import { useEffect, useRef, useState } from "react";
import { DashboardHttpError } from "../../api/http/error.js";
import {showToast} from '../../components/Toast.js';
export const money = (cents: number | null, currency = "BRL") => cents === null ? "Indisponível" : new Intl.NumberFormat("pt-BR", {style: "currency", currency}).format(cents / 100);
export const date = (value: string | null) => value ? new Date(value).toLocaleDateString("pt-BR", {timeZone: "UTC"}) : "Indisponível";
export const metricSourceLabel=(value:string)=>value==='meta_reported'?'Meta':value==='meta_reported+zyon_reconciled'?'Meta e pedidos confirmados na Zyon':'Consulta dos anúncios';
export function attributionWindowLabel(value:string|null|undefined):string{
  if(!value)return 'Não informado';
  const parts=value.split(/[+,]/).map(part=>part.trim());
  if(parts.some(part=>!/^\d+d_(click|view)$/.test(part)))return 'Período definido na Meta';
  return parts.map(part=>{const [days,kind]=part.split('d_');return `${Number(days)} ${Number(days)===1?'dia':'dias'} após ${kind==='click'?'clique':'visualização'}`;}).join(' e ');
}
export const priorities = {paid_sales: "Vendas pagas", cost_per_purchase: "Custo por compra", roas: "Retorno dos anúncios", contribution: "Resultado com custos informados"};
export const actions = {prepare: "Preparar na Meta", publish: "Publicar", pause: "Pausar", budget: "Alterar orçamento", creative: "Alterar criativo", audience: "Alterar público", launch: "Lançar campanha"};
export const executionStates = {reserved: "Aguardando envio", sending: "Enviando à Meta", remote_draft: "Preparada, sem veiculação", remote_paused: "Pausada na Meta", publishing: "Publicação em processamento", active_unconfirmed: "Ativa, veiculação ainda não confirmada", delivered: "Veiculação confirmada", failed: "Falha confirmada", execution_unknown: "Resultado desconhecido. Consulte o estado antes de qualquer nova ação."};
const reasons:Record<string,string>={
  observed_attribution_not_causal_uplift:'A Meta associa essas vendas aos anúncios, mas isso não garante que os anúncios causaram todas as vendas.',
  confirmed_orders_require_verified_origin:'Vendas confirmadas exigem a origem do pedido verificada.',
  historical_costs_incomplete:'Faltam custos registrados das vendas. Ainda não é possível calcular o resultado.',
  currency_mismatch:'Os valores usam moedas diferentes e não podem ser combinados.',
  meta_account_changed:'A conta de anúncios mudou. Revise a conexão antes de continuar.',
  fresh_metrics:'métricas atualizadas',spend:'gasto de mídia confirmado',confirmed_purchases:'vendas confirmadas',confirmed_purchases_required:'vendas confirmadas',
  rolling_metrics:'métricas da janela de avaliação',attributed_revenue_and_currency:'receita atribuída e moeda compatível',cost_per_purchase:'custo por compra',historical_costs:'custos históricos dos produtos',
  automatic_budget_control_verification_required:'A publicação depende da verificação do controle financeiro na Meta.',
  media_spend_separate_from_subscription:'O investimento dos anúncios é pago diretamente à Meta, separado da assinatura.',
  revocation_does_not_pause_ads:'Voltar ao manual não pausa anúncios que já estão na Meta.',
};
export function adReason(value:string):string {
  if(reasons[value])return reasons[value];
  if(value.startsWith('Aguardando dados: '))return `Aguardando dados: ${value.slice(18).split(',').map(item=>adReason(item.trim())).join(', ')}.`;
  return /^[a-z][a-z0-9_.:-]*$/i.test(value)&&/[_.]/.test(value)?'Parte dos dados ainda não está disponível. Confira a coleta e a conexão.':value;
}
export function errorMessage(error: unknown): string {
  let code = ""; if (error instanceof DashboardHttpError) {try {code = JSON.parse(error.responseBody).code;} catch { /* Public fallback below. */ }}
  const messages: Record<string, string> = {
    addon_offer_changed: "A oferta mudou. Atualize os dados e revise o novo valor antes de contratar.",
    addon_checkout_pending: "A contratação está pendente. Confira o pagamento antes de iniciar outra compra.",
    addon_not_entitled: "É necessário um plano Growth ou Escala e adicional ativo para esta ação.",
    proposal_stale: "A campanha mudou. Crie uma nova proposta e revise novamente.",
    proposal_version_changed: "Esta proposta mudou. Atualize os dados e revise novamente.",
    creative_terms_mismatch: "O criativo diverge das condições do catálogo. Revise o conteúdo.",
    insufficient_image_credits: "Saldo de imagens insuficiente. Revise o consumo ou compre extras.",
    meta_connection_changed: "A conexão mudou. Conecte e revise os ativos novamente.",
    meta_permission_missing: "Falta uma permissão na Meta. Revise sua conexão.",
  };
  return messages[code] ?? "Não foi possível confirmar a operação. Atualize os dados antes de tentar novamente.";
}
export interface ActionFeedback {type:'success'|'error';text:string;}
export function executionFeedback(result:{status:keyof typeof executionStates}):ActionFeedback {
  return {type:['failed','execution_unknown'].includes(result.status)?'error':'success',text:executionStates[result.status]};
}
export function generationFeedback(result:{status:string}):ActionFeedback {
  return result.status==='failed'||result.status==='unknown'
    ?{type:'error',text:'A geração precisa de revisão. Consulte o resultado antes de solicitar novamente.'}
    :{type:'success',text:result.status==='succeeded'?'Imagens geradas. Revise os criativos.':result.status==='partial'?'Parte das imagens ficou pronta. Revise os resultados.':'Geração de imagens solicitada. Acompanhe o preparo.'};
}
export function useAction() {
  const lock = useRef(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const lifetime=useRef({active:true,version:0});
  useEffect(()=>{lifetime.current.active=true;return()=>{lifetime.current.active=false;lifetime.current.version++;};},[]);
  function notify(type:ActionFeedback['type'],text:string){if(lifetime.current.active)showToast(type,text);}
  async function run<T>(work:()=>Promise<T>,feedback?:string|((value:T)=>ActionFeedback)) {
    if(lock.current)return;lock.current=true;const version=lifetime.current.version;
    const current=()=>lifetime.current.active&&version===lifetime.current.version;
    setBusy(true);setError('');
    try{const value=await work();if(current()&&feedback){const message=typeof feedback==='string'?{type:'success' as const,text:feedback}:feedback(value);notify(message.type,message.text);}}
    catch(e){if(current()){const message=errorMessage(e);setError(message);notify('error',message);}}
    finally{lock.current=false;if(current())setBusy(false);}
  }
  return {busy, error, run, notify};
}
export function checkoutNavigate(url: string) {const target = new URL(url); if (target.protocol !== "https:" || target.hostname !== "checkout.stripe.com") throw new Error("invalid_checkout_url"); window.location.assign(target.href);}
