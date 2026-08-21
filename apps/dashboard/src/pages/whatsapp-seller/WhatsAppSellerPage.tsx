import React, { useEffect, useState, useCallback } from "react";
import { Smartphone, CheckCircle, XCircle, Loader2, Send, ExternalLink } from "lucide-react";
import { SectionHeader } from "../../components/SectionHeader.js";
import { StatCard } from "../overview/components/StatCard.js";
import { Button } from "../../components/Button.js";
import { FormField } from "../../components/FormField.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import type { MerchantProfile } from "../../api-client.js";

// ─── Meta FB SDK types ────────────────────────────────────────────────────────
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
    /** WhatsApp Embedded Signup extras — returned when config_id targets WhatsApp */
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
    sessionInfoVersion?: string;
  };
}

// ─── Config ───────────────────────────────────────────────────────────────────
const META_APP_ID = ((import.meta as any).env?.VITE_META_APP_ID as string) || "1350309300356518";
const EMBEDDED_SIGNUP_CONFIG_ID = ((import.meta as any).env?.VITE_EMBEDDED_SIGNUP_CONFIG_ID as string) || "2347331535755786";

type ConnectionStatus = "disconnected" | "pending_verification" | "active" | "inactive" | "error";

interface WhatsAppConfig {
  enabled: boolean;
  provider: string;
  whatsappNumber?: string;
  status: ConnectionStatus;
  connectedAt?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────
export function WhatsAppSellerPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useApi();
  const [config, setConfig] = useState<WhatsAppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);

  // Verification form state
  const [verificationCode, setVerificationCode] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);

  const merchantId = props.me?.id;

  // ─── Load Meta FB SDK ─────────────────────────────────────────────────────
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

    // Load SDK script
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

  // ─── Load config ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!merchantId) return;
    loadConfig();
  }, [merchantId]);

  async function loadConfig() {
    setLoading(true);
    try {
      const data = await api.getWhatsAppConfig(merchantId!);
      setConfig(data);
    } catch {
      setConfig({ enabled: false, provider: "TWILIO", status: "disconnected" });
    } finally {
      setLoading(false);
    }
  }

  // ─── Meta Embedded Signup ─────────────────────────────────────────────────
  const handleEmbeddedSignup = useCallback(() => {
    if (!merchantId) return;
    if (!window.FB) {
      showToast("error", "Meta SDK ainda carregando. Tente novamente.");
      return;
    }

    setSaving(true);
    setConnectError(null);

    // Timeout: if popup doesn't return in 2 minutes, reset state
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

          // Send to backend
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
          sessionInfoVersion: "3",
        },
      },
    );
  }, [merchantId, api, config]);

  // ─── Verify OTP ───────────────────────────────────────────────────────────
  async function handleVerify() {
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
  }

  // ─── Disconnect ───────────────────────────────────────────────────────────
  async function handleDisconnect() {
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
  }

  // ─── Test message ─────────────────────────────────────────────────────────
  async function handleTestMessage() {
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
  }

  // ─── Toggle ───────────────────────────────────────────────────────────────
  async function handleToggleEnabled(enabled: boolean) {
    if (!merchantId) return;
    try {
      const result = await api.toggleWhatsApp(merchantId, enabled);
      setConfig(result);
    } catch {
      showToast("error", "Erro ao alterar status");
    }
  }

  // ─── Guard: no user ───────────────────────────────────────────────────────
  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <span className="eyebrow">Integrações</span>
          <h1>WhatsApp Seller</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  if (loading) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <Loader2 size={24} className="spin" />
      </div>
    );
  }

  const status = config?.status ?? "disconnected";

  return (
    <>
      <SectionHeader
        title="WhatsApp Seller"
        subtitle="Receba pedidos diretamente no WhatsApp dos seus clientes"
        trailing={
          status === "active" ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--color-success)", fontSize: 13, fontWeight: 600 }}>
              <CheckCircle size={14} /> Conectado
            </span>
          ) : null
        }
      />

      {/* ── ACTIVE STATE ── */}
      {status === "active" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Toggle + Info */}
          <div className="panel" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px" }}>
            <div>
              <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)" }}>Canal WhatsApp</div>
              <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 4 }}>
                Número: <strong>+{config?.whatsappNumber?.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, "$1 $2 $3-$4")}</strong>
                {config?.connectedAt && ` · Desde ${new Date(config.connectedAt).toLocaleDateString("pt-BR")}`}
              </div>
            </div>
            <ToggleSwitch checked={config?.enabled ?? false} onChange={handleToggleEnabled} />
          </div>

          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
            <StatCard label="Conversas hoje" value="—" icon={<Smartphone size={16} />} />
            <StatCard label="Taxa de conversão" value="—" icon={<CheckCircle size={16} />} />
            <StatCard label="Tempo de resposta" value="~3s" icon={<Send size={16} />} />
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="outline" size="sm" onClick={handleTestMessage} disabled={testSending}>
              {testSending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
              Enviar mensagem de teste
            </Button>
            <Button variant="ghost" size="sm" onClick={handleDisconnect} disabled={saving}>
              <XCircle size={14} /> Desconectar
            </Button>
          </div>

          {/* How it works */}
          <div className="panel" style={{ padding: "20px 24px" }}>
            <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-brand)", marginBottom: 12 }}>Como funciona</div>
            <ol style={{ font: "13px/1.8 var(--font-sans)", color: "var(--color-text-muted)", paddingLeft: 20, margin: 0 }}>
              <li>Cliente envia mensagem para seu número WhatsApp</li>
              <li>Nosso agente responde automaticamente com catálogo, preços e opções</li>
              <li>Cliente adiciona ao carrinho respondendo com números</li>
              <li>Ao finalizar, coletamos dados e enviamos link de pagamento</li>
              <li>Após pagamento, confirmação chega no WhatsApp</li>
            </ol>
          </div>
        </div>
      )}

      {/* ── PENDING VERIFICATION ── */}
      {status === "pending_verification" && (
        <div className="panel" style={{ padding: "32px 28px", maxWidth: 480 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
            <Loader2 size={20} className="spin" style={{ color: "var(--color-brand)" }} />
            <span style={{ font: "600 15px var(--font-sans)", color: "var(--color-text)" }}>Verificação pendente</span>
          </div>
          <p style={{ font: "13px/1.6 var(--font-sans)", color: "var(--color-text-muted)", margin: "0 0 20px" }}>
            Enviamos um código de verificação para o número cadastrado via SMS.
            Digite abaixo para ativar o canal.
          </p>
          <FormField
            label="Código de verificação"
            type="text"
            placeholder="123456"
            value={verificationCode}
            onChange={(v) => setVerificationCode(v.replace(/\D/g, "").slice(0, 6))}
            maxLength={6}
          />
          <div style={{ marginTop: 16 }}>
            <Button variant="primary" onClick={handleVerify} disabled={saving || verificationCode.length < 6}>
              {saving ? <Loader2 size={14} className="spin" /> : <CheckCircle size={14} />}
              Verificar
            </Button>
          </div>
        </div>
      )}

      {/* ── DISCONNECTED — META EMBEDDED SIGNUP ── */}
      {(status === "disconnected" || status === "inactive" || status === "error") && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Value proposition */}
          <div className="panel" style={{ padding: "24px 28px", borderLeft: "3px solid var(--color-brand)" }}>
            <div style={{ font: "600 15px var(--font-sans)", color: "var(--color-text)", marginBottom: 8 }}>
              Venda pelo WhatsApp sem instalar nada
            </div>
            <p style={{ font: "13px/1.6 var(--font-sans)", color: "var(--color-text-muted)", margin: 0 }}>
              Seus clientes compram produtos, escolhem frete e pagam — tudo dentro da conversa no WhatsApp.
              O agente de IA faz tudo automaticamente usando menus numerados.
            </p>
          </div>

          {/* Embedded Signup CTA */}
          <div className="panel" style={{ padding: "28px", maxWidth: 520 }}>
            <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)", marginBottom: 6 }}>
              Conectar seu WhatsApp Business
            </div>
            <p style={{ font: "12px/1.5 var(--font-sans)", color: "var(--color-text-muted)", margin: "0 0 20px" }}>
              Conecte sua conta Meta Business para usar o WhatsApp comercial.
              Você será redirecionado para o Facebook para autorizar o acesso.
            </p>

            <Button
              variant="primary"
              onClick={handleEmbeddedSignup}
              disabled={saving || !sdkReady}
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              {saving ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <ExternalLink size={14} />
              )}
              {saving ? "Conectando..." : "Conectar via Meta Business"}
            </Button>

            {!sdkReady && (
              <p style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)", marginTop: 8 }}>
                Carregando Meta SDK...
              </p>
            )}

            {connectError && (
              <div style={{ padding: "10px 14px", background: "var(--color-error-bg, rgba(239,68,68,0.1))", borderRadius: 8, font: "12px/1.5 var(--font-sans)", color: "var(--color-error, #ef4444)", marginTop: 12 }}>
                {connectError}
              </div>
            )}
          </div>

          {/* How it works */}
          <div className="panel" style={{ padding: "20px 24px" }}>
            <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-brand)", marginBottom: 12 }}>
              Como funciona
            </div>
            <ol style={{ font: "13px/1.8 var(--font-sans)", color: "var(--color-text-muted)", paddingLeft: 20, margin: 0 }}>
              <li>Clique em "Conectar via Meta Business" acima</li>
              <li>Faça login no Facebook e selecione sua conta Business</li>
              <li>Escolha ou crie seu número WhatsApp Business</li>
              <li>Receba um código SMS para verificação</li>
              <li>Pronto! Seus clientes já podem comprar pelo WhatsApp</li>
            </ol>
            <p style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)", marginTop: 12 }}>
              Seu número continua funcionando normalmente. As mensagens de compra são processadas pelo agente de IA.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
