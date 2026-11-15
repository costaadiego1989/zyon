import { useRef, useState } from "react";
import { DashboardHttpError } from "../../api/http/error.js";
export const money = (cents: number | null, currency = "BRL") => cents === null ? "Indisponível" : new Intl.NumberFormat("pt-BR", {style: "currency", currency}).format(cents / 100);
export const date = (value: string | null) => value ? new Date(value).toLocaleDateString("pt-BR", {timeZone: "UTC"}) : "Indisponível";
export const priorities = {paid_sales: "Vendas pagas", cost_per_purchase: "Custo por compra", roas: "ROAS", contribution: "Contribuição após mídia"};
export const actions = {prepare: "Preparar na Meta", publish: "Publicar", pause: "Pausar", budget: "Alterar orçamento", creative: "Alterar criativo", audience: "Alterar público"};
export const executionStates = {reserved: "Aguardando envio", sending: "Enviando à Meta", remote_draft: "Preparada, sem veiculação", remote_paused: "Pausada na Meta", publishing: "Publicação em processamento", active_unconfirmed: "Ativa, veiculação ainda não confirmada", delivered: "Veiculação confirmada", failed: "Falha confirmada", execution_unknown: "Resultado desconhecido. Consulte o estado antes de qualquer nova ação."};
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
