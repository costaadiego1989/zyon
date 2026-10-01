const PROVIDERS: Record<string, string> = {
  bling: "Bling", mercadolivre: "Mercado Livre", shopee: "Shopee", tiktokshop: "TikTok Shop",
};

export function erpSyncErrorMessage(code: string): string {
  if (code === "erp_multi_location_requires_mapping") return "A sincronização foi bloqueada porque há vários locais de estoque sem vínculo definido. Peça ao suporte para configurar os locais.";
  if (code === "erp_marketplace_reconnect_required" || code === "erp_marketplace_refresh_token_missing") return "Esta conexão precisa ser autorizada novamente. Desconecte e conecte a mesma conta para renovar o acesso.";
  if (code === "erp_marketplace_duplicate_product_or_sku") return "Há produtos ou SKUs repetidos no marketplace. Revise os códigos antes de sincronizar novamente.";
  if (code.endsWith("managed_stock_not_supported")) return "Este estoque é gerenciado pelo marketplace e não pode ser sincronizado por este conector. Peça ao suporte para revisar o vínculo.";
  return "A última sincronização não foi concluída. Tente Sincronizar agora. Se o erro continuar, entre em contato com o suporte.";
}

export function erpOAuthHttpError(provider: string, responseBody?: string): string {
  let code = "erp_callback_error";
  try {
    const payload: unknown = JSON.parse(responseBody ?? "");
    if (payload && typeof payload === "object" && "code" in payload && typeof payload.code === "string" && payload.code.startsWith("erp_")) code = payload.code;
  } catch { /* Never render raw HTTP/provider text. */ }
  return erpOAuthResult(new URLSearchParams({ error: code, erp_provider: provider }))!.message;
}

export function erpOAuthResult(params: URLSearchParams, currentMerchantId?: string): { kind: "success" | "error"; message: string } | null {
  const connected = params.get("erp_connected");
  const providerKey = params.get("erp_provider") ?? "";
  const provider = Object.hasOwn(PROVIDERS, providerKey) ? PROVIDERS[providerKey] : "ERP";
  const error = params.get("error");
  if (error?.startsWith("erp_")) {
    const messages: Record<string, string> = {
      erp_provider_not_configured: `A integração com ${provider} ainda não foi configurada neste ambiente. Entre em contato com o suporte da Zyon para configurar o aplicativo.`,
      erp_marketplace_account_already_connected: `Esta conta do ${provider} já está conectada a outra loja. Use uma conta diferente para manter os estoques separados.`,
      erp_marketplace_account_change_requires_unlink: `Esta loja tem produtos vinculados a outra conta do ${provider}. Reconecte a conta anterior ou peça ao suporte para revisar os vínculos antes de trocar.`,
      erp_shop_selection_required: `A autorização retornou várias lojas do ${provider}. Autorize apenas a loja desejada ou peça ao suporte para configurar o vínculo.`,
      erp_marketplace_seller_required: `Entre no ${provider} com uma conta de vendedor para conectar sua loja.`,
      erp_initial_sync_failed: `${provider} foi autorizado, mas a importação não pôde ser agendada. Na loja conectada, clique em Sincronizar agora.`,
      erp_permission_denied: `${provider} recusou a autorização: o usuário conectado não tem permissão para os recursos solicitados. Entre no ${provider} com um administrador da empresa e tente conectar novamente. Se já for administrador, confira as permissões do aplicativo e a situação da conta no ${provider}.`,
      erp_denied: `A autorização no ${provider} não foi concluída. Clique em Conectar e autorize o acesso na conta da empresa.`,
      erp_app_inactive: `O aplicativo de integração está inativo no ${provider}. Entre em contato com o suporte da Zyon para revisar a integração.`,
      erp_csrf: "Não foi possível validar esta tentativa de conexão. Inicie novamente pelo botão Conectar na loja desejada.",
      erp_token_failed: `Não foi possível concluir a autorização no ${provider}. Inicie uma nova tentativa pelo botão Conectar.`,
    };
    return { kind: "error", message: Object.hasOwn(messages, error) ? messages[error] : `Não foi possível concluir a conexão com o ${provider}. Tente novamente.` };
  }
  if (connected && Object.hasOwn(PROVIDERS, connected)) {
    if (currentMerchantId && params.get("erp_merchant") && params.get("erp_merchant") !== currentMerchantId) {
      return { kind: "error", message: `${PROVIDERS[connected]} foi conectado à loja em que você iniciou a autorização. Selecione essa loja para acompanhar a sincronização.` };
    }
    return { kind: "success", message: `${PROVIDERS[connected]} conectado com sucesso` };
  }
  return null;
}
