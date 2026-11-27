import { DashboardHttpError } from "../../api/http/error.js";
import type { MarketingContact } from "../../api/marketing.js";

export const marketingMoney = (cents: number) =>
  (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
export const marketingDate = (value: string) =>
  new Date(value).toLocaleString("pt-BR");
export const contactName = (contact: MarketingContact) =>
  contact.name ||
  (contact.phone ? `Contato • ${contact.phone.slice(-4)}` : "Contato do site");
export const originLabel = (origin: MarketingContact["origin"]) =>
  ({ site: "Site", whatsapp: "WhatsApp", unknown: "Não identificada" }[origin]);
export function marketingError(error: unknown) {
  if (error instanceof DashboardHttpError) {
    let code = "";
    try {
      const body = JSON.parse(error.responseBody);
      code = body.code ?? body.message;
    } catch {}
    const messages: Record<string, string> = {
      marketing_approved_template_required:
        "O template precisa estar aprovado pela Meta para aprovar esta campanha.",
      marketing_settings_required:
        "Configure horários, frequência e retenção antes de aprovar uma campanha.",
      marketing_campaign_budget_insufficient:
        "A reserva prevista do público ultrapassa o orçamento. Ajuste o público ou o orçamento.",
      marketing_eligible_audience_empty:
        "Não há contatos com telefone e autorização comprovada neste público.",
      marketing_campaign_audience_too_large:
        "O público é muito amplo para uma campanha. Escolha um segmento menor.",
      marketing_campaign_already_dispatched:
        "Esta campanha já teve tentativas de envio. Crie uma nova campanha para mudar a mensagem.",
      marketing_template_reconciliation_required:
        "Verifique a situação do template antes de tentar uma nova submissão.",
      marketing_service_window_expired:
        "A janela de atendimento terminou. Aguarde uma mensagem do cliente ou use um template aprovado.",
    };
    if (typeof code === "string" && messages[code]) return messages[code];
    if (error.status === 409)
      return "Os dados mudaram. Atualize a tela antes de tentar novamente.";
    if (error.status === 403)
      return "Esta ação exige o plano Growth ou superior e a permissão da sua equipe.";
    if (error.status === 404)
      return "Este registro não está disponível para sua loja.";
    if (error.status === 400)
      return "Confira os campos e as condições para realizar esta ação.";
  }
  return "Não foi possível carregar ou salvar agora. Tente novamente.";
}
export function marketingCents(value: string): number | null {
  if (!/^\d{1,8}(?:[,.]\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ""] = value.trim().split(/[,.]/);
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents > 0 && cents <= 2147483647
    ? cents
    : null;
}
