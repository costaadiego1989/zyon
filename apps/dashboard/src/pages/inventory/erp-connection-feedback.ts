type Connection = { status: string; lastErrorCode?: string | null; requiresReconnect?: boolean; retryAfterAt?: string | null };

const messages: Record<string, string> = {
  erp_bling_app_changed: "A autorização pertence a uma versão anterior do aplicativo Zyon. Reconecte sua conta Bling para continuar.",
  erp_bling_reauthorization_required: "O Bling recusou a autorização salva. Reconecte sua conta para retomar a sincronização.",
  erp_bling_token_refresh_failed: "Não foi possível renovar a autorização. Reconecte sua conta Bling.",
  erp_bling_app_configuration_invalid: "A configuração do aplicativo Bling precisa ser revisada pelo suporte da Zyon.",
  erp_omie_credentials_invalid_or_app_suspended: "O Omie recusou as chaves ou suspendeu o aplicativo. Confira se seu aplicativo está ativo e atualize a App Key e a App Secret.",
  erp_omie_access_denied: "O Omie negou o acesso. Confira as credenciais e permissões do seu aplicativo e atualize as chaves.",
  erp_omie_http_403: "O Omie negou o acesso. Confira se seu aplicativo está ativo e se as chaves estão corretas.",
  erp_omie_temporarily_blocked: "O Omie bloqueou temporariamente as consultas. A sincronização será retomada após a pausa, sem precisar reenviar as chaves.",
  erp_omie_rate_limited: "O limite de consultas do Omie foi atingido. A sincronização será retomada após a pausa.",
  erp_omie_daily_limit: "O limite diário do seu aplicativo Omie foi atingido. A sincronização está aguardando a próxima tentativa.",
  erp_provider_cooldown: "O provedor solicitou uma pausa. Aguarde a próxima tentativa automática.",
  omie_credentials_required: "Preencha a App Key e a App Secret da sua empresa.",
  omie_application_change_requires_disconnect: "Essas chaves pertencem a outro aplicativo Omie. Desconecte o aplicativo atual antes de trocar de empresa ou aplicativo.",
  bling_company_change_requires_disconnect: "Essa autorização pertence a outra empresa Bling. Desconecte a empresa atual antes de trocar a conta.",
};

export function erpErrorMessage(error: unknown): string {
  let code = typeof error === "string" ? error : error instanceof Error ? error.message : "";
  if (error && typeof error === "object" && "responseBody" in error && typeof error.responseBody === "string") {
    try { const body = JSON.parse(error.responseBody); code = typeof body.message === "string" ? body.message : typeof body.code === "string" ? body.code : code; } catch { /* Use a safe fallback. */ }
  }
  return messages[code] ?? "Não foi possível conectar. Confira as credenciais da sua empresa e tente novamente.";
}

export function erpConnectionFeedback(connection?: Connection | null) {
  const code = connection?.lastErrorCode ?? "";
  const requiresReconnect = Boolean(connection?.requiresReconnect || /^(erp_bling_(app_changed|reauthorization_required|token_refresh_failed|app_configuration_invalid)|erp_omie_(credentials_invalid_or_app_suspended|access_denied|http_403))$/.test(code));
  const retryAt = connection?.retryAfterAt ? Date.parse(connection.retryAfterAt) : NaN;
  const paused = Number.isFinite(retryAt) && retryAt > Date.now();
  const connected = connection?.status === "connected";
  const attention = requiresReconnect || connection?.status === "error";
  return {
    requiresReconnect, paused,
    canSync: connected && !requiresReconnect && !paused,
    variant: attention ? "error" : paused || code ? "warning" : connected ? "success" : "neutral",
    label: code === "erp_bling_app_configuration_invalid" ? "Suporte necessário" : attention ? "Reconexão necessária" : paused ? "Aguardando provedor" : code ? "Sincronização com erro" : connected ? "Conectado" : "Não conectado",
    message: code ? messages[code] ?? "A última sincronização falhou. Confira a conexão antes de tentar novamente." : null,
    supportRequired: code === "erp_bling_app_configuration_invalid",
  } as const;
}
