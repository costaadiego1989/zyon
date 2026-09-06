import { useCallback, useEffect, useState } from "react";
import type { MerchantProfile } from "../../api-client.js";
import { useApi } from "../../hooks/useApi.js";
import { usePlanFeatures } from "../../hooks/api/usePlanFeatures.js";
import { showToast } from "../../components/Toast.js";

declare global {
  interface Window {
    FB: {
      init(params: { appId: string; version: string; cookie?: boolean; xfbml?: boolean }): void;
      login(callback: (response: FBLoginResponse) => void, params: FBLoginParams): void;
    };
    fbAsyncInit: () => void;
  }
}

interface FBLoginResponse {
  status: string;
  authResponse?: {
    code?: string;
    accessToken?: string;
    userID?: string;
    expiresIn?: number;
    signedRequest?: string;
  } & {
    extras?: {
      setup?: {
        waba_id?: string;
        phone_number_id?: string;
      };
    };
  };
}

interface FBLoginParams {
  config_id: string;
  response_type: string;
  override_default_response_type: boolean;
  extras?: {
    setup?: Record<string, unknown>;
    featureType?: string;
  };
}

type ConnectionStatus = "disconnected" | "pending_verification" | "active" | "inactive" | "error";

interface WhatsAppConfig {
  enabled: boolean;
  provider: string;
  whatsappNumber?: string;
  status: ConnectionStatus;
  connectedAt?: string;
}

interface TemplatePackageStatus {
  total: number;
  approved: number;
  submitted: number;
  rejected: number;
  draft: number;
  perType: Array<{ type: string; status: string; rejectionReason?: string | null }>;
}

const META_APP_ID = ((import.meta as any).env?.VITE_META_APP_ID as string) || "2277752126311176";
const EMBEDDED_SIGNUP_CONFIG_ID = ((import.meta as any).env?.VITE_EMBEDDED_SIGNUP_CONFIG_ID as string) || "869983652735597";

export interface UseWhatsAppSellerPageArgs {
  me: MerchantProfile | null;
}

export interface WhatsAppSellerPageVM {
  // data
  config: WhatsAppConfig | null;
  templatePackageStatus: TemplatePackageStatus | null;
  // status
  loading: boolean;
  saving: boolean;
  testSending: boolean;
  sdkReady: boolean;
  // verification form
  verificationCode: string;
  setVerificationCode: (v: string) => void;
  connectError: string | null;
  // actions
  handleEmbeddedSignup: () => void;
  handleVerify: () => Promise<void>;
  handleDisconnect: () => Promise<void>;
  handleTestMessage: () => Promise<void>;
  handleToggleEnabled: (enabled: boolean) => Promise<void>;
}

export function useWhatsAppSellerPage({ me }: UseWhatsAppSellerPageArgs): WhatsAppSellerPageVM {
  const api = useApi();
  const { hasFeature, loading: planLoading, error: planError } = usePlanFeatures();
  const canManageTemplates = !planLoading && !planError && hasFeature("postSale");
  const [config, setConfig] = useState<WhatsAppConfig | null>(null);
  const [templatePackageStatus, setTemplatePackageStatus] = useState<TemplatePackageStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [verificationCode, setVerificationCode] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);

  const merchantId = me?.id;

  // Load Meta FB SDK
  useEffect(() => {
    if (window.FB) {
      setSdkReady(true);
      return;
    }

    window.fbAsyncInit = () => {
      window.FB.init({
        appId: META_APP_ID,
        cookie: true,
        xfbml: false,
        version: "v21.0",
      });
      setSdkReady(true);
    };

    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    document.body.appendChild(script);

    return () => {
      // Cleanup: don't remove script (FB SDK should persist)
    };
  }, []);

  // Load config
  useEffect(() => {
    if (!merchantId) return;
    loadConfig();
  }, [merchantId]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getWhatsAppConfig(merchantId!);
      setConfig(data);
    } catch {
      setConfig({ enabled: false, provider: "TWILIO", status: "disconnected" });
    } finally {
      setLoading(false);
    }
  }, [api, merchantId]);

  useEffect(() => {
    let cancelled = false;
    setTemplatePackageStatus(null);
    if (merchantId && canManageTemplates) {
      void api.getTemplatePackageStatus().then(status => {
        if (!cancelled) setTemplatePackageStatus(status);
      }).catch(() => { if (!cancelled) setTemplatePackageStatus(null); });
    }
    return () => { cancelled = true; };
  }, [api, merchantId, canManageTemplates]);

  const handleEmbeddedSignup = useCallback(() => {
    if (!merchantId) return;
    if (!window.FB) {
      showToast("error", "Meta SDK ainda carregando. Tente novamente.");
      return;
    }

    setSaving(true);
    setConnectError(null);

    const timeout = setTimeout(() => {
      setSaving(false);
      setConnectError("Tempo esgotado. O popup pode ter sido bloqueado ou fechado. Permita popups e tente novamente.");
    }, 120_000);

    window.FB.login(
      (response: FBLoginResponse) => {
        clearTimeout(timeout);
        console.log("[WhatsApp Seller] FB.login response:", JSON.stringify(response, null, 2));
        void (async () => {
          try {
            if (response.status !== "connected" || !response.authResponse?.code) {
              setSaving(false);
              if (response.status === "unknown") {
                return;
              }
              setConnectError("Conexão cancelada ou não autorizada pelo Facebook.");
              return;
            }

            const code = response.authResponse.code;
            const wabaId = response.authResponse.extras?.setup?.waba_id;
            const phoneNumberId = response.authResponse.extras?.setup?.phone_number_id;

            if (!wabaId || !phoneNumberId) {
              setConnectError("Configuração incompleta do WhatsApp Business. Tente novamente e selecione um número.");
              setSaving(false);
              return;
            }

            const result = await api.connectWhatsAppViaEmbeddedSignup(merchantId, {
              code,
              wabaId,
              phoneNumberId,
            });

            const validStatuses = ["active", "pending_verification"];
            if (result && validStatuses.includes(result.status)) {
              setConfig({
                ...config,
                status: result.status as ConnectionStatus,
                whatsappNumber: result.whatsappNumber,
                enabled: result.status === "active",
                provider: "TWILIO",
              });
              showToast("success", result.status === "active" ? "WhatsApp conectado!" : "Código de verificação enviado via SMS!");
            } else {
              const errorMsg = result?.status === "PLATFORM_NOT_CONFIGURED"
                ? "Plataforma não configurada. Entre em contato com o suporte."
                : result?.status === "TOKEN_EXCHANGE_FAILED"
                  ? "Falha na autenticação Meta. Tente novamente."
                  : result?.message || result?.status || "Resposta inesperada. Tente novamente.";
              setConnectError(errorMsg);
            }
          } catch (err: any) {
            const msg = err?.responseBody || err?.message || "Erro ao conectar. Verifique se a API está rodando.";
            setConnectError(typeof msg === "string" ? msg.slice(0, 150) : "Erro ao conectar");
            showToast("error", "Falha ao conectar WhatsApp");
          } finally {
            setSaving(false);
          }
        })();
      },
      {
        config_id: EMBEDDED_SIGNUP_CONFIG_ID,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "",
        },
      },
    );
  }, [merchantId, api, config]);

  const handleVerify = useCallback(async () => {
    if (!merchantId || !verificationCode.trim()) return;
    setSaving(true);
    try {
      const result = await api.verifyWhatsApp(merchantId, { code: verificationCode.trim() });
      if (result?.status === "active") {
        setConfig({
          ...config,
          status: "active",
          enabled: true,
          provider: "TWILIO",
          connectedAt: new Date().toISOString(),
        });
        showToast("success", "WhatsApp verificado com sucesso!");
      } else {
        showToast("error", result?.status === "INVALID_CODE" ? "Código inválido" : "Erro na verificação");
      }
    } catch (err: any) {
      showToast("error", err?.message ?? "Código inválido");
    } finally {
      setSaving(false);
    }
  }, [api, merchantId, verificationCode, config]);

  const handleDisconnect = useCallback(async () => {
    if (!merchantId) return;
    if (!confirm("Desconectar WhatsApp? Seus clientes não poderão mais comprar por este canal.")) return;
    setSaving(true);
    try {
      await api.disconnectWhatsApp(merchantId);
      setConfig({ enabled: false, provider: "TWILIO", status: "disconnected" });
      showToast("success", "WhatsApp desconectado");
    } catch {
      showToast("error", "Erro ao desconectar");
    } finally {
      setSaving(false);
    }
  }, [api, merchantId]);

  const handleTestMessage = useCallback(async () => {
    if (!merchantId) return;
    setTestSending(true);
    try {
      await api.testWhatsApp(merchantId);
      showToast("success", "Mensagem de teste enviada!");
    } catch {
      showToast("error", "Falha ao enviar teste");
    } finally {
      setTestSending(false);
    }
  }, [api, merchantId]);

  const handleToggleEnabled = useCallback(async (enabled: boolean) => {
    if (!merchantId) return;
    try {
      const result = await api.toggleWhatsApp(merchantId, enabled);
      setConfig(result);
    } catch {
      showToast("error", "Erro ao alterar status");
    }
  }, [api, merchantId]);

  return {
    config,
    templatePackageStatus,
    loading,
    saving,
    testSending,
    sdkReady,
    verificationCode,
    setVerificationCode,
    connectError,
    handleEmbeddedSignup,
    handleVerify,
    handleDisconnect,
    handleTestMessage,
    handleToggleEnabled,
  };
}
