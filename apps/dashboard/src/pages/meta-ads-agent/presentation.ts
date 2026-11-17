import { useRef, useState } from "react";
import { DashboardHttpError } from "../../api/http/error.js";
export const money = (cents: number | null, currency = "BRL") => cents === null ? "Indisponível" : new Intl.NumberFormat("pt-BR", {style: "currency", currency}).format(cents / 100);
export const date = (value: string | null) => value ? new Date(value).toLocaleDateString("pt-BR", {timeZone: "UTC"}) : "Indisponível";
export const priorities = {paid_sales: "Vendas pagas", cost_per_purchase: "Custo por compra", roas: "ROAS", contribution: "Contribuição após mídia"};
export const actions = {prepare: "Preparar na Meta", publish: "Publicar", pause: "Pausar", budget: "Alterar orçamento", creative: "Alterar criativo", audience: "Alterar público"};
export const executionStates = {reserved: "Aguardando envio", sending: "Enviando à Meta", remote_draft: "Preparada, sem veiculação", remote_paused: "Pausada na Meta", publishing: "Publicação em processamento", active_unconfirmed: "Ativa, veiculação ainda não confirmada", delivered: "Veiculação confirmada", failed: "Falha confirmada", execution_unknown: "Resultado desconhecido. Consulte o estado antes de qualquer nova ação."};
const reasons:Record<string,string>={
  observed_attribution_not_causal_uplift:'A receita atribuída é uma observação da Meta; não comprova aumento causal das vendas.',
  confirmed_orders_require_verified_origin:'Vendas confirmadas exigem a origem do pedido verificada.',
  historical_costs_incomplete:'Custos históricos incompletos. Ainda não é possível calcular a contribuição.',
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
export function useAction() {
  const lock = useRef(false); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function run(work: () => Promise<void>) {if (lock.current) return; lock.current = true; setBusy(true); setError(""); try {await work();} catch (e) {setError(errorMessage(e));} finally {lock.current = false; setBusy(false);}}
  return {busy, error, run};
}
export function checkoutNavigate(url: string) {const target = new URL(url); if (target.protocol !== "https:" || target.hostname !== "checkout.stripe.com") throw new Error("invalid_checkout_url"); window.location.assign(target.href);}
