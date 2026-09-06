import { DashboardHttpError } from "../api/http/error.js";

const messages: Record<string, string> = {
  asaas_account_owner_mismatch: "Não foi possível confirmar a titularidade do cadastro Asaas. Entre em contato com o suporte da Zyon para vincular sua conta.",
  asaas_account_recovery_unavailable: "Encontramos seu cadastro Asaas, mas a vinculação precisa ser liberada pela Zyon. Entre em contato com o suporte para concluir a conexão.",
  asaas_api_key_required: "Informe a chave de API da sua conta Asaas.",
  asaas_api_key_invalid: "A chave Asaas não tem um formato válido. Copie a chave completa em Integrações no Asaas.",
  asaas_environment_mismatch: "A chave não pertence ao ambiente selecionado. Confira se ela é de produção ou sandbox.",
  asaas_wallet_not_found: "Não foi possível identificar a carteira da conta Asaas. Revise as permissões da chave.",
  asaas_birth_date_required: "Informe a data de nascimento do titular para conectar o Asaas.",
  asaas_company_type_required: "Selecione o tipo da empresa para conectar o Asaas.",
  asaas_tax_id_invalid: "Confira o CPF ou CNPJ do titular da conta Asaas.",
  asaas_connection_not_found: "Nenhuma conexão Asaas foi salva. Confira os dados e crie a subconta.",
  asaas_platform_failed: "O Asaas não concluiu a solicitação. Confira os dados do cadastro e tente novamente. Se o erro continuar, entre em contato com o suporte da Zyon.",
  stripe_connect_not_enabled: "A conexão Stripe ainda não foi habilitada pela plataforma. Entre em contato com o suporte da Zyon.",
  stripe_connect_credentials_invalid: "A configuração Stripe da plataforma precisa ser revisada pelo suporte da Zyon.",
  stripe_connect_account_unavailable: "A conta Stripe vinculada não está disponível. Entre em contato com o suporte da Zyon.",
  stripe_connect_unavailable: "Não foi possível iniciar a conexão Stripe. Tente novamente em alguns minutos.",
  mercadopago_oauth_not_configured: "A conexão Mercado Pago ainda não foi configurada pela plataforma. Entre em contato com o suporte da Zyon.",
};

export function paymentConnectionError(error: unknown): string | undefined {
  if (!(error instanceof DashboardHttpError)) return undefined;
  try {
    const { code, detail } = JSON.parse(error.responseBody);
    if (code === "asaas_platform_failed" && typeof detail === "string" && detail.startsWith("asaas: ")) {
      return `Asaas: ${detail.slice(7, 607)}`;
    }
    return Object.prototype.hasOwnProperty.call(messages, code) ? messages[code] : undefined;
  } catch { return undefined; }
}
