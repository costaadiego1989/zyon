import React from "react";
import { Smartphone, CheckCircle, XCircle, Loader2, Send, ExternalLink } from "lucide-react";
import { SectionHeader } from "../../components/SectionHeader.js";
import { StatCard } from "../overview/components/StatCard.js";
import { Button } from "../../components/Button.js";
import { FormField } from "../../components/FormField.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import type { MerchantProfile } from "../../api-client.js";
import { useWhatsAppSellerPage } from "./useWhatsAppSellerPage.js";

export function WhatsAppSellerPage(props: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const vm = useWhatsAppSellerPage({ me: props.me });

  // Guard: no user
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

  if (vm.loading) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <Loader2 size={24} className="spin" />
      </div>
    );
  }

  const status = vm.config?.status ?? "disconnected";

  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">Integrações</span>
          <h1>WhatsApp Seller</h1>
          <p className="page-lead">Receba pedidos diretamente no WhatsApp dos seus clientes</p>
        </div>
        {status === "active" && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--color-success)", fontSize: 13, fontWeight: 600 }}>
            <CheckCircle size={14} /> Conectado
          </span>
        )}
      </header>

      {/* ── ACTIVE STATE ── */}
      {status === "active" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* Toggle + Info */}
          <div className="panel" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px" }}>
            <div>
              <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-brand)" }}>Canal WhatsApp</div>
              <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 4 }}>
                Número: <strong>+{vm.config?.whatsappNumber?.replace(/(\d{2})(\d{2})(\d{5})(\d{4})/, "$1 $2 $3-$4")}</strong>
                {vm.config?.connectedAt && ` · Desde ${new Date(vm.config.connectedAt).toLocaleDateString("pt-BR")}`}
              </div>
            </div>
            <ToggleSwitch checked={vm.config?.enabled ?? false} onChange={vm.handleToggleEnabled} />
          </div>

          {/* KPIs */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
            <StatCard label="Conversas hoje" value="—" icon={<Smartphone size={16} />} />
            <StatCard label="Taxa de conversão" value="—" icon={<CheckCircle size={16} />} />
            <StatCard label="Tempo de resposta" value="~3s" icon={<Send size={16} />} />
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 10 }}>
            <Button variant="outline" size="sm" onClick={vm.handleTestMessage} disabled={vm.testSending}>
              {vm.testSending ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
              Enviar mensagem de teste
            </Button>
            <Button variant="ghost" size="sm" onClick={vm.handleDisconnect} disabled={vm.saving}>
              <XCircle size={14} /> Desconectar
            </Button>
          </div>

          {/* How it works */}
          <div className="panel" style={{ padding: "20px 24px" }}>
            <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-brand)", marginBottom: 14 }}>Como funciona</div>
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
            <span style={{ font: "600 14px var(--font-sans)", color: "var(--color-brand)" }}>Verificação pendente</span>
          </div>
          <p style={{ font: "13px/1.6 var(--font-sans)", color: "var(--color-text-muted)", margin: "0 0 20px" }}>
            Enviamos um código de verificação para o número cadastrado via SMS.
            Digite abaixo para ativar o canal.
          </p>
          <FormField
            label="Código de verificação"
            type="text"
            placeholder="123456"
            value={vm.verificationCode}
            onChange={(v) => vm.setVerificationCode(v.replace(/\D/g, "").slice(0, 6))}
            maxLength={6}
          />
          <div style={{ marginTop: 16 }}>
            <Button variant="primary" onClick={vm.handleVerify} disabled={vm.saving || vm.verificationCode.length < 6}>
              {vm.saving ? <Loader2 size={14} className="spin" /> : <CheckCircle size={14} />}
              Verificar
            </Button>
          </div>
        </div>
      )}

      {/* ── DISCONNECTED — META EMBEDDED SIGNUP ── */}
      {(status === "disconnected" || status === "inactive" || status === "error") && (
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          {/* Value proposition */}
          <div className="panel" style={{ padding: "24px 28px" }}>
            <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-brand)", marginBottom: 14 }}>Venda pelo WhatsApp sem instalar nada</div>
            <p style={{ font: "13px/1.6 var(--font-sans)", color: "var(--color-text-muted)", margin: 0 }}>
              Seus clientes compram produtos, escolhem frete e pagam — tudo dentro da conversa no WhatsApp.
              O agente de IA faz tudo automaticamente usando menus numerados.
            </p>
          </div>

          {/* Embedded Signup CTA */}
          <div className="panel" style={{ padding: "28px" }}>
            <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-brand)", marginBottom: 14 }}>
              Conectar seu WhatsApp Business
            </div>
            <p style={{ font: "12px/1.5 var(--font-sans)", color: "var(--color-text-muted)", margin: "0 0 20px" }}>
              Conecte sua conta Meta Business para usar o WhatsApp comercial.
              Você será redirecionado para o Facebook para autorizar o acesso.
            </p>

            <Button
              variant="primary"
              onClick={vm.handleEmbeddedSignup}
              disabled={vm.saving || !vm.sdkReady}
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              {vm.saving ? (
                <Loader2 size={14} className="spin" />
              ) : (
                <ExternalLink size={14} />
              )}
              {vm.saving ? "Conectando..." : "Conectar via Meta Business"}
            </Button>

            {!vm.sdkReady && (
              <p style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)", marginTop: 8 }}>
                Carregando Meta SDK...
              </p>
            )}

            {vm.connectError && (
              <div style={{ padding: "10px 14px", background: "var(--color-error-bg, rgba(239,68,68,0.1))", borderRadius: 8, font: "12px/1.5 var(--font-sans)", color: "var(--color-error, #ef4444)", marginTop: 12 }}>
                {vm.connectError}
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
    </div>
  );
}
