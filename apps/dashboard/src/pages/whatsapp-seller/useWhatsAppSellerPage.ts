import { useCallback, useEffect, useRef, useState } from "react";
import type { MerchantProfile } from "../../api-client.js";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import { launchEmbeddedSignup, loadFacebookSdk, type EmbeddedSignupSettings } from "./embedded-signup.js";

export interface WhatsAppConfig {
  enabled: boolean; provider: string; whatsappNumber?: string | null; connectedAt?: string | null;
  status: string; senderStatus?: string | null; onboardingError?: string | null; error?: string;
}
const metaErrors: Record<`META_${string}`, string> = {
  META_AUTHORIZATION_FAILED: "Não foi possível confirmar sua autorização com a Meta. Inicie a conexão novamente.",
  META_ASSET_NOT_AUTHORIZED: "A conta Business ou o número escolhido não foi autorizado para esta loja. Revise a seleção na Meta e tente novamente.",
  META_SUBSCRIPTION_FAILED: "A Meta não confirmou a ativação do canal. Atualize o estado para consultar a conexão.",
  META_SUBSCRIPTION_UNKNOWN: "A ativação do canal ainda está sendo confirmada pela Meta. Atualize o estado em instantes.",
  META_SUBSCRIPTION_NOT_CONFIRMED: "A conexão ainda não foi confirmada pela Meta. Atualize o estado ou tente novamente mais tarde.",
  META_CREDENTIALS_UNAVAILABLE: "Não foi possível recuperar as credenciais da conexão Meta. Inicie a conexão novamente.",
};

const legacyConnectionReviewMessage = "Há uma conexão anterior não ativa nesta loja que precisa de revisão antes de usar a conexão oficial da Meta.";

export function onboardingErrorMessage(code?: string | null) {
  if (!code) return null;
  if (code === "WHATSAPP_CONNECTION_REVIEW_REQUIRED") return legacyConnectionReviewMessage;
  if (code.startsWith("META_")) {
    return metaErrors[code as `META_${string}`] ?? "A Meta não confirmou esta etapa. Atualize o estado para consultar a conexão.";
  }
  return "Não foi possível confirmar a conexão. Atualize o estado para consultar novamente.";
}
export function useWhatsAppSellerPage({ me }: { me: MerchantProfile | null }) {
  const api = useApi();
  const merchantId = me?.id;
  const [config, setConfig] = useState<WhatsAppConfig | null>(null);
  const [settings, setSettings] = useState<EmbeddedSignupSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const operation = useRef(false);
  const scope = useRef(0);
  const signup = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (!merchantId) { setLoading(false); return; }
    const generation = scope.current;
    setLoading(true);
    try {
      const [connection, onboarding] = await Promise.all([api.getWhatsAppConfig(merchantId), api.getWhatsAppOnboarding(merchantId)]);
      if (scope.current !== generation) return;
      setConfig(connection);
      setSettings(onboarding);
      setConnectError(onboardingErrorMessage(connection.onboardingError));
    } catch {
      if (scope.current === generation) setConnectError("Não foi possível carregar a conexão. Tente novamente.");
    } finally { if (scope.current === generation) setLoading(false); }
  }, [api, merchantId]);

  useEffect(() => {
    scope.current++;
    setConfig(null);
    setSettings(null);
    setSaving(false);
    operation.current = false;
    void load();
    return () => { scope.current++; signup.current?.abort(); };
  }, [load]);

  useEffect(() => {
    let active = true;
    setSdkReady(false);
    if (settings?.configured) void loadFacebookSdk(settings.appId)
      .then(() => { if (active) setSdkReady(true); })
      .catch(error => { if (active) setConnectError(error.message); });
    return () => { active = false; };
  }, [settings?.appId, settings?.configured]);

  const accept = useCallback((result: WhatsAppConfig) => {
    setConfig(result);
    setConnectError(onboardingErrorMessage(result.error ?? result.onboardingError));
  }, []);

  const run = useCallback(async (action: () => Promise<WhatsAppConfig>) => {
    if (!merchantId || operation.current) return;
    operation.current = true;
    const generation = scope.current;
    setSaving(true);
    setConnectError(null);
    try {
      const result = await action();
      if (scope.current === generation) accept(result);
    } catch {
      if (scope.current === generation) setConnectError("Não foi possível concluir esta etapa. Atualize o estado antes de tentar novamente.");
    } finally {
      if (scope.current === generation) { operation.current = false; setSaving(false); }
    }
  }, [merchantId, accept]);

  const refresh = useCallback(() => run(() => api.refreshWhatsApp(merchantId!)), [run, api, merchantId]);
  useEffect(() => {
    if (!["provisioning", "verifying", "pending_verification"].includes(config?.status ?? "") || config?.onboardingError) return;
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 15_000);
    return () => window.clearInterval(timer);
  }, [config?.status, config?.onboardingError, refresh]);

  const handleEmbeddedSignup = useCallback(() => {
    if (!merchantId || !settings?.configured || !sdkReady || operation.current) return;
    operation.current = true;
    const generation = scope.current;
    const controller = new AbortController();
    signup.current = controller;
    setSaving(true);
    setConnectError(null);
    // The call stays synchronous with the click, so browsers can open the popup.
    void launchEmbeddedSignup(settings, controller.signal).then(async result => {
      if (controller.signal.aborted || scope.current !== generation) return;
      let response;
      try { response = await api.connectWhatsAppViaEmbeddedSignup(merchantId, result); }
      catch { throw new Error("Não foi possível concluir o cadastro. Atualize o estado para consultar a conexão antes de tentar novamente."); }
      if (scope.current !== generation) return;
      accept(response);
      if (response.status === "active" && !response.error) showToast("success", "Conexão oficial da Meta ativada.");
    }).catch(error => {
      if (scope.current === generation) setConnectError(error instanceof Error && !("status" in error)
        ? error.message : "Não foi possível concluir o cadastro. Atualize o estado para consultar a conexão.");
    }).finally(() => {
      if (scope.current === generation) { operation.current = false; setSaving(false); signup.current = null; }
    });
  }, [merchantId, settings, sdkReady, api, accept]);

  return {
    config, settings, loading, saving, sdkReady, connectError,
    load, refresh, handleEmbeddedSignup,
    cancelSignup: () => signup.current?.abort(),
    awaitingAuthorization: Boolean(signup.current),
    handleDisconnect: () => run(() => api.disconnectWhatsApp(merchantId!)),
    handleToggleEnabled: (enabled: boolean) => run(() => api.toggleWhatsApp(merchantId!, enabled)),
  };
}
