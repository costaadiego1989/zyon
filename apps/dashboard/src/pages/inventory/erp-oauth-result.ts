const PROVIDERS: Record<string, string> = {
  bling: "Bling", mercadolivre: "Mercado Livre", shopee: "Shopee", tiktokshop: "TikTok Shop",
};

export function erpOAuthResult(params: URLSearchParams): { kind: "success" | "error"; message: string } | null {
  const connected = params.get("erp_connected");
  const providerKey = params.get("erp_provider") ?? "";
  const provider = Object.hasOwn(PROVIDERS, providerKey) ? PROVIDERS[providerKey] : "ERP";
  const error = params.get("error");
  if (error?.startsWith("erp_")) {
    const messages: Record<string, string> = {
      erp_permission_denied: `${provider} recusou a autorização: o usuário conectado não tem permissão para os recursos solicitados. Entre no ${provider} com um administrador da empresa e tente conectar novamente. Se já for administrador, confira as permissões do aplicativo e a situação da conta no ${provider}.`,
      erp_denied: `A autorização no ${provider} não foi concluída. Clique em Conectar e autorize o acesso na conta da empresa.`,
      erp_app_inactive: `O aplicativo de integração está inativo no ${provider}. Entre em contato com o suporte da Zyon para revisar a integração.`,
      erp_csrf: "Não foi possível validar esta tentativa de conexão. Inicie novamente pelo botão Conectar na loja desejada.",
      erp_token_failed: `Não foi possível concluir a autorização no ${provider}. Inicie uma nova tentativa pelo botão Conectar.`,
    };
    return { kind: "error", message: Object.hasOwn(messages, error) ? messages[error] : `Não foi possível concluir a conexão com o ${provider}. Tente novamente.` };
  }
  if (connected && Object.hasOwn(PROVIDERS, connected)) {
    return { kind: "success", message: `${PROVIDERS[connected]} conectado com sucesso` };
  }
  return null;
}
