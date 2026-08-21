import React from "react";
import { Code2, Webhook } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { useProtocolPage } from "./useProtocolPage.js";

export interface ProtocolPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

const TABLE_STYLE: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  font: "13px var(--font-sans)",
};

const TH_STYLE: React.CSSProperties = {
  textAlign: "left",
  padding: "10px 14px",
  borderBottom: "1px solid var(--color-border)",
  font: "600 11px var(--font-mono)",
  letterSpacing: "0.04em",
  color: "var(--color-text-faint)",
};

const TD_STYLE: React.CSSProperties = {
  padding: "10px 14px",
  borderBottom: "1px solid var(--color-border)",
  color: "var(--color-text)",
};

function formatDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function ProtocolPage(props: ProtocolPageProps) {
  const vm = useProtocolPage({ me: props.me });

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <h1>Checkout Programável</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">Checkout</span>
          <h1>Checkout Protocol</h1>
          <p className="page-lead">Conecte seu sistema ao checkout via API</p>
        </div>
      </header>

      {/* Value Proposition */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <p style={{ font: "14px var(--font-sans)", color: "var(--color-text)", margin: 0, lineHeight: 1.55 }}>
          Permita que seu software interno (ERP, CRM, automação) inicie e controle sessões de checkout programaticamente.
          Sua equipe de TI pode integrar o checkout direto no ERP — sem depender do dashboard.
        </p>
      </div>

      {/* Como funciona */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <SectionHeader variant="secondary" title="Como funciona" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 14 }}>
          {[
            { n: 1, t: "Crie uma chave de API", d: "Gere credenciais para autenticar seu sistema no protocolo." },
            { n: 2, t: "Integre no seu sistema", d: "Conecte ERP, CRM ou automação usando os endpoints REST." },
            { n: 3, t: "Controle o checkout via código", d: "Inicie sessões, acompanhe estados e receba webhooks." },
          ].map((step) => (
            <div key={step.n} style={{ padding: 14, border: "1px solid var(--color-border)", borderRadius: 9, background: "var(--surface-1)" }}>
              <div style={{ font: "600 11px var(--font-mono)", color: "var(--color-brand)", marginBottom: 6 }}>PASSO {step.n}</div>
              <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)", marginBottom: 4 }}>{step.t}</div>
              <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", lineHeight: 1.45 }}>{step.d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Exemplo concreto */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <SectionHeader variant="secondary" title="Exemplo de uso" />
        <p style={{ font: "13px var(--font-sans)", color: "var(--color-text)", margin: 0, lineHeight: 1.55 }}>
          Seu ERP pode criar um checkout com produtos pré-selecionados quando um vendedor fecha um pedido.
          O sistema recebe o evento <code style={{ font: "12px var(--font-mono)", color: "var(--color-brand)" }}>session.completed</code> via webhook e dá baixa automática no estoque.
        </p>
      </div>

      {/* Para quem serve */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <SectionHeader variant="secondary" title="Para quem serve" />
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          {["Empresas com ERP próprio", "Equipes de TI e integrações", "Automações de vendas", "Plataformas B2B customizadas"].map((tag) => (
            <span
              key={tag}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: "1px solid var(--color-border)",
                font: "12px var(--font-sans)",
                color: "var(--color-text)",
                background: "var(--surface-1)",
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      </div>

      {/* Config Section */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)", marginBottom: 16 }}>Configuração</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <ToggleSwitch
              checked={vm.tempConfig.protocol_enabled}
              onChange={(v) => vm.setTempConfig({ ...vm.tempConfig, protocol_enabled: v })}
            />
            <span style={{ font: "13px var(--font-sans)", color: "var(--color-text)" }}>
              {vm.tempConfig.protocol_enabled ? "Protocolo habilitado" : "Protocolo desabilitado"}
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <label style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", minWidth: 120 }}>
              Webhook URL:
            </label>
            <input
              type="url"
              placeholder="https://your-api.com/webhooks"
              value={vm.tempConfig.webhook_url}
              onChange={(e) => vm.setTempConfig({ ...vm.tempConfig, webhook_url: e.target.value })}
              style={{
                flex: 1,
                maxWidth: 400,
                padding: "6px 10px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                background: "var(--surface-1)",
                color: "var(--color-text)",
                font: "13px var(--font-mono)",
              }}
            />
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <label style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", minWidth: 120 }}>
              TTL (minutos):
            </label>
            <input
              type="number"
              min={5}
              max={1440}
              value={vm.tempConfig.ttl_minutes}
              onChange={(e) => vm.setTempConfig({ ...vm.tempConfig, ttl_minutes: Number(e.target.value) })}
              style={{
                width: 90,
                padding: "6px 10px",
                borderRadius: "var(--radius-sm)",
                border: "1px solid var(--color-border)",
                background: "var(--surface-1)",
                color: "var(--color-text)",
                font: "13px var(--font-mono)",
              }}
            />
            <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>(padrão: 30min)</span>
          </div>
          <div>
            <Button variant="primary" size="sm" onClick={vm.handleSaveConfig} disabled={vm.saving}>
              Salvar configuração
            </Button>
          </div>
        </div>
      </div>

      {/* Sessions Table */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <div style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)", marginBottom: 16 }}>Sessões ativas</div>

        {vm.loading ? (
          <div style={{ padding: "40px 0", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>
            Carregando sessões...
          </div>
        ) : vm.sessions.length === 0 ? (
          <EmptyState
            icon={Code2}
            title="Nenhuma sessão ativa"
            description="Agents externos usam /protocol/start para iniciar sessões de checkout automatizado."
          />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={TABLE_STYLE}>
              <thead>
                <tr>
                  <th style={TH_STYLE}>Agent ID</th>
                  <th style={TH_STYLE}>Estado</th>
                  <th style={TH_STYLE}>Criado em</th>
                  <th style={TH_STYLE}>Expira em</th>
                </tr>
              </thead>
              <tbody>
                {vm.sessions.map((session) => (
                  <tr key={session.id}>
                    <td style={TD_STYLE}>
                      <code style={{ font: "12px var(--font-mono)" }}>{session.agent_id}</code>
                    </td>
                    <td style={TD_STYLE}>
                      <span style={{
                        padding: "3px 8px",
                        borderRadius: 5,
                        font: "600 10px var(--font-mono)",
                        background: "var(--color-brand-subtle)",
                        color: "var(--color-brand)",
                      }}>
                        {session.current_state}
                      </span>
                    </td>
                    <td style={TD_STYLE}>{formatDate(session.created_at)}</td>
                    <td style={TD_STYLE}>{formatDate(session.expires_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Webhook Log */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
          <Webhook size={16} color="var(--color-brand)" />
          <span style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)" }}>Webhook log (últimas 10 entregas)</span>
        </div>

        {vm.webhookLogs.length === 0 ? (
          <div style={{ padding: "24px 0", textAlign: "center", color: "var(--color-text-faint)", font: "13px var(--font-sans)" }}>
            Nenhuma entrega registrada
          </div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={TABLE_STYLE}>
              <thead>
                <tr>
                  <th style={TH_STYLE}>Evento</th>
                  <th style={TH_STYLE}>Status</th>
                  <th style={TH_STYLE}>Tentativas</th>
                  <th style={TH_STYLE}>Data</th>
                </tr>
              </thead>
              <tbody>
                {vm.webhookLogs.map((log) => (
                  <tr key={log.id}>
                    <td style={TD_STYLE}>
                      <code style={{ font: "12px var(--font-mono)" }}>{log.event_type}</code>
                    </td>
                    <td style={TD_STYLE}>
                      <span style={{
                        padding: "3px 8px",
                        borderRadius: 5,
                        font: "600 10px var(--font-mono)",
                        background: log.status === "success" ? "var(--color-success-bg)" : log.status === "failed" ? "var(--color-error-bg)" : "var(--color-warning-bg)",
                        color: log.status === "success" ? "var(--color-success)" : log.status === "failed" ? "var(--color-error)" : "var(--color-warning)",
                      }}>
                        {log.status}
                      </span>
                    </td>
                    <td style={TD_STYLE}>{log.attempts}</td>
                    <td style={TD_STYLE}>{formatDate(log.delivered_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
