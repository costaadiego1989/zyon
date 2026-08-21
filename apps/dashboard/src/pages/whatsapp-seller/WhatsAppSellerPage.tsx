import React, { useEffect, useState } from "react";
import { Smartphone, CheckCircle, XCircle, Loader2, Send } from "lucide-react";
import { SectionHeader } from "../../components/SectionHeader.js";
import { StatCard } from "../overview/components/StatCard.js";
import { Button } from "../../components/Button.js";
import { FormField } from "../../components/FormField.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { useApi } from "../../hooks/useApi.js";
import { showToast } from "../../components/Toast.js";
import { maskPhone } from "../../utils/masks.js";
import type { MerchantProfile } from "../../api-client.js";

type ConnectionStatus = "disconnected" | "pending_verification" | "active" | "inactive" | "error";

interface WhatsAppConfig {
  enabled: boolean;
  provider: string;
  whatsappNumber?: string;
  status: ConnectionStatus;
  connectedAt?: string;
}

export function WhatsAppSellerPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const api = useApi();
  const [config, setConfig] = useState<WhatsAppConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testSending, setTestSending] = useState(false);

  // Form state
  const [phoneNumber, setPhoneNumber] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);

  const merchantId = props.me?.id;

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

  async function handleConnect() {
    const digits = phoneNumber.replace(/\D/g, "");
    if (!merchantId || digits.length < 10) {
      showToast("error", "Informe um número válido com DDD");
      return;
    }
    setSaving(true);
    setConnectError(null);
    try {
      const result = await api.connectWhatsApp(merchantId, {
        provider: "TWILIO",
        phoneNumber: digits.startsWith("55") ? digits : `55${digits}`,
      });
      const validStatuses = ["active", "pending_verification", "disconnected", "inactive"];
      if (result && validStatuses.includes(result.status)) {
        setConfig(result);
        showToast("ok", result.status === "active" ? "WhatsApp conectado!" : "Código de verificação enviado via SMS!");
      } else {
        const errorMsg = result?.status === "INVALID_CREDENTIALS"
          ? "Credenciais inválidas. Entre em contato com o suporte."
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
  }

  async function handleVerify() {
    if (!merchantId || !verificationCode.trim()) return;
    setSaving(true);
    try {
      const result = await api.verifyWhatsApp(merchantId, { code: verificationCode.trim() });
      setConfig(result);
      showToast("ok", "WhatsApp verificado com sucesso!");
    } catch (err: any) {
      showToast("error", err?.message ?? "Código inválido");
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnect() {
    if (!merchantId) return;
    if (!confirm("Desconectar WhatsApp? Seus clientes não poderão mais comprar por este canal.")) return;
    setSaving(true);
    try {
      await api.disconnectWhatsApp(merchantId);
      setConfig({ enabled: false, provider: "TWILIO", status: "disconnected" });
      showToast("ok", "WhatsApp desconectado");
    } catch {
      showToast("error", "Erro ao desconectar");
    } finally {
      setSaving(false);
    }
  }

  async function handleTestMessage() {
    if (!merchantId) return;
    setTestSending(true);
    try {
      await api.testWhatsApp(merchantId);
      showToast("ok", "Mensagem de teste enviada!");
    } catch {
      showToast("error", "Falha ao enviar teste");
    } finally {
      setTestSending(false);
    }
  }

  async function handleToggleEnabled(enabled: boolean) {
    if (!merchantId) return;
    try {
      const result = await api.toggleWhatsApp(merchantId, enabled);
      setConfig(result);
    } catch {
      showToast("error", "Erro ao alterar status");
    }
  }

  if (!props.me) {
    return (
      <header className="page-head">
        <h1>WhatsApp Seller</h1>
        <p className="page-lead">Login necessário</p>
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
              <div style={{ font: "600 14px var(--sans)", color: "var(--ink)" }}>Canal WhatsApp</div>
              <div style={{ font: "12px var(--sans)", color: "var(--muted)", marginTop: 4 }}>
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
            <div style={{ font: "600 13px var(--sans)", color: "var(--accent)", marginBottom: 12 }}>Como funciona</div>
            <ol style={{ font: "13px/1.8 var(--sans)", color: "var(--muted)", paddingLeft: 20, margin: 0 }}>
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
            <Loader2 size={20} className="spin" style={{ color: "var(--accent)" }} />
            <span style={{ font: "600 15px var(--sans)", color: "var(--ink)" }}>Verificação pendente</span>
          </div>
          <p style={{ font: "13px/1.6 var(--sans)", color: "var(--muted)", margin: "0 0 20px" }}>
            Enviamos um código de verificação para o número cadastrado via SMS.
            Digite abaixo para ativar o canal.
          </p>
          <FormField label="Código de verificação">
            <input
              type="text"
              placeholder="123456"
              value={verificationCode}
              onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              style={{ font: "16px var(--mono)", letterSpacing: 4, textAlign: "center" }}
            />
          </FormField>
          <div style={{ marginTop: 16 }}>
            <Button variant="primary" onClick={handleVerify} disabled={saving || verificationCode.length < 6}>
              {saving ? <Loader2 size={14} className="spin" /> : <CheckCircle size={14} />}
              Verificar
            </Button>
          </div>
        </div>
      )}

      {/* ── DISCONNECTED — SETUP FORM ── */}
      {(status === "disconnected" || status === "inactive" || status === "error") && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Value proposition */}
          <div className="panel" style={{ padding: "24px 28px", borderLeft: "3px solid var(--accent)" }}>
            <div style={{ font: "600 15px var(--sans)", color: "var(--ink)", marginBottom: 8 }}>
              Venda pelo WhatsApp sem instalar nada
            </div>
            <p style={{ font: "13px/1.6 var(--sans)", color: "var(--muted)", margin: 0 }}>
              Seus clientes compram produtos, escolhem frete e pagam — tudo dentro da conversa no WhatsApp.
              O agente de IA faz tudo automaticamente usando menus numerados.
            </p>
          </div>

          {/* Connection form — ONLY phone number */}
          <div className="panel" style={{ padding: "28px", maxWidth: 520 }}>
            <div style={{ font: "600 14px var(--sans)", color: "var(--ink)", marginBottom: 6 }}>
              Conectar seu WhatsApp
            </div>
            <p style={{ font: "12px/1.5 var(--sans)", color: "var(--muted)", margin: "0 0 20px" }}>
              Informe o número do WhatsApp que seus clientes usarão para comprar.
              Enviaremos um código de verificação por SMS para confirmar a titularidade.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <FormField
                label="Número do WhatsApp"
                type="tel"
                placeholder="(21) 99300-1883"
                hint="Com DDD (ex: (21) 99300-1883)"
                value={maskPhone(phoneNumber)}
                onChange={(v) => setPhoneNumber(v.replace(/\D/g, "").slice(0, 11))}
                maxLength={15}
              />

              <Button variant="primary" onClick={handleConnect} disabled={saving || phoneNumber.length < 10}>
                {saving ? <Loader2 size={14} className="spin" /> : <Smartphone size={14} />}
                Conectar WhatsApp
              </Button>

              {connectError && (
                <div style={{ padding: "10px 14px", background: "var(--danger-soft, rgba(239,68,68,0.1))", borderRadius: 8, font: "12px/1.5 var(--sans)", color: "var(--danger, #ef4444)" }}>
                  ⚠️ {connectError}
                </div>
              )}
            </div>
          </div>

          {/* How it works */}
          <div className="panel" style={{ padding: "20px 24px" }}>
            <div style={{ font: "600 13px var(--sans)", color: "var(--accent)", marginBottom: 12 }}>
              Como funciona
            </div>
            <ol style={{ font: "13px/1.8 var(--sans)", color: "var(--muted)", paddingLeft: 20, margin: 0 }}>
              <li>Informe seu número de WhatsApp acima</li>
              <li>Receba um código de verificação por SMS</li>
              <li>Digite o código para confirmar</li>
              <li>Pronto! Seus clientes já podem comprar pelo WhatsApp</li>
            </ol>
            <p style={{ font: "11px var(--sans)", color: "var(--faint)", marginTop: 12 }}>
              Seu número continua funcionando normalmente. As mensagens de compra são processadas pelo agente de IA.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
