import { DashboardHttpError } from "../../api/http/index.js";

type DomainOperation = "load" | "add" | "verify" | "remove";

export function domainErrorMessage(error: unknown, operation: DomainOperation): string {
  if (error instanceof DashboardHttpError) {
    if (error.status === 0) return "Não conseguimos conectar ao serviço de domínios. Confira sua conexão e tente novamente.";
    if (error.status === 401) return "Sua sessão expirou. Entre novamente para gerenciar os domínios.";
    if (error.status === 403) return "Sua conta não tem acesso a esta ação. Confira as permissões e o plano da loja.";
    if (error.status === 429) return "Há muitas solicitações neste momento. Aguarde um pouco e tente novamente.";
    if (error.responseBody.includes("domain_already_registered")) return "Este domínio já está registrado. Confira o endereço ou use outro domínio.";
    if (error.responseBody.includes("invalid_domain")) return "Informe um domínio válido, como loja.suaempresa.com.br, sem https:// ou caminhos.";
    if (error.responseBody.includes("dns_verification_unavailable")) return "Não conseguimos consultar o DNS agora. Os dados do domínio foram preservados. Tente verificar novamente em instantes.";
    if (error.responseBody.includes("domain_not_found")) return "Este domínio não está mais na loja. Atualize a página para conferir os endereços disponíveis.";
  }
  return {
    load: "Não foi possível carregar os domínios. Tente novamente em instantes.",
    add: "Não foi possível adicionar o domínio. O endereço foi mantido para você tentar novamente.",
    verify: "Não foi possível verificar o domínio. Confira a conexão e tente novamente.",
    remove: "Não foi possível remover o domínio. Ele continua na lista; tente novamente.",
  }[operation];
}
