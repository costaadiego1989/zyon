import React, { useState } from "react";
import { Plug, Unplug, ExternalLink, Users } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { SidePanel } from "../../components/SidePanel.js";
import { Button } from "../../components/Button.js";
import { useIntegrationsPage, type CrmConnectionDTO } from "./useIntegrationsPage.js";

export interface IntegrationsPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

interface CrmProviderMeta {
  provider: string;
  name: string;
  description: string;
  tokenLabel: string;
  tokenPlaceholder: string;
  generateUrl: string;
}

const CRM_PROVIDERS: CrmProviderMeta[] = [
  {
    provider: "hubspot",
    name: "HubSpot",
    description: "CRM e automação de marketing. Cria contato + deal a cada venda.",
    tokenLabel: "Private App Token",
    tokenPlaceholder: "pat-na1-...",
    generateUrl: "https://app.hubspot.com/private-apps",
  },
  {
    provider: "pipedrive",
    name: "Pipedrive",
    description: "CRM focado em pipeline de vendas. Acompanha cada conversão.",
    tokenLabel: "API Token",
    tokenPlaceholder: "Ex: 1a2b3c4d5e6f...",
    generateUrl: "https://app.pipedrive.com/settings/api",
  },
  {
    provider: "rdstation",
    name: "RD Station",
    description: "Marketing e CRM brasileiro. Rastreia leads até conversão.",
    tokenLabel: "Token",
    tokenPlaceholder: "Ex: seu token RD Station",
    generateUrl: "https://app.rdstation.com.br/integracoes",
  },
];

const MARKETING_PROVIDERS = [
  { name: "Mailchimp", description: "Email marketing e automação" },
  { name: "ActiveCampaign", description: "Automação de marketing e CRM" },
  { name: "Klaviyo", description: "Email e SMS marketing para e-commerce" },
];

export function IntegrationsPage(props: IntegrationsPageProps) {
  const vm = useIntegrationsPage({ me: props.me });
  const [panelProvider, setPanelProvider] = useState<CrmProviderMeta | null>(null);
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <span className="eyebrow">Conectar</span>
          <h1>Integrações</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  const openPanel = (meta: CrmProviderMeta) => {
    setPanelProvider(meta);
    setToken("");
  };

  const closePanel = () => {
    setPanelProvider(null);
    setToken("");
    setSaving(false);
  };

  const handleSave = async () => {
    if (!panelProvider || !token.trim()) return;
    setSaving(true);
    try {
      await vm.connectCrm(panelProvider.provider, { token: token.trim() });
      closePanel();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container">
      {/* Header */}
      <header className="page-head">
        <div>
          <span className="eyebrow">Conectar</span>
          <h1>Integrações</h1>
          <p className="page-lead">Conecte CRMs e ferramentas de marketing para sincronizar contatos e leads automaticamente</p>
        </div>
      </header>

      {/* Explanation Card */}
      <div style={{
        padding: "16px 20px",
        borderRadius: "var(--radius-md)",
        background: "var(--accent-soft)",
        border: "1px solid var(--accent-line)",
        font: "13px var(--font-sans)",
        color: "var(--color-brand)",
        lineHeight: 1.65,
      }}>
        <strong style={{ color: "var(--color-text)" }}>Como funciona:</strong> quando um comprador finaliza uma compra ou é identificado, o sistema sincroniza automaticamente o contato e cria um negócio (deal) no CRM conectado. Ideal para nutrir leads e acompanhar conversões.
      </div>

      {/* Section: CRM */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <SectionHeader icon={<Users size={16} />} title="CRM" subtitle="Sincronize contatos e negócios com seu CRM automaticamente" />
        <div className="grid-3" style={{ gap: 14 }}>
          {CRM_PROVIDERS.map((meta) => (
            <CrmProviderCard
              key={meta.provider}
              name={meta.name}
              description={meta.description}
              connection={vm.crmConnections.find((c) => c.provider === meta.provider)}
              onConnect={() => openPanel(meta)}
              onDisconnect={(id) => vm.disconnectCrm(id)}
            />
          ))}
        </div>
      </div>

      {/* Section: Marketing */}
      <div className="panel" style={{ padding: "20px 24px" }}>
        <SectionHeader icon={<ExternalLink size={16} />} title="Marketing" subtitle="Ferramentas de email e automação de marketing" />
        <div className="grid-3" style={{ gap: 14 }}>
          {MARKETING_PROVIDERS.map((m) => (
            <CrmProviderCard
              key={m.name}
              name={m.name}
              description={m.description}
              comingSoon
            />
          ))}
        </div>
      </div>

      {/* Side panel: connect CRM */}
      <SidePanel
        isOpen={panelProvider != null}
        title={panelProvider ? `Conectar ${panelProvider.name}` : ""}
        onClose={closePanel}
      >
        {panelProvider && (
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <p style={{ margin: 0, font: "13px var(--font-sans)", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
              Cole o token de acesso do {panelProvider.name} para sincronizar contatos e negócios. Não tem?{" "}
              <a
                href={panelProvider.generateUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--color-brand)", textDecoration: "underline" }}
              >
                Gerar token →
              </a>
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <label style={{ font: "600 11px var(--font-sans)", color: "var(--color-text-muted)" }}>{panelProvider.tokenLabel}</label>
              <input
                type="password"
                placeholder={panelProvider.tokenPlaceholder}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                style={{
                  padding: "8px 12px",
                  border: "1px solid var(--color-border)",
                  borderRadius: "var(--radius-sm)",
                  font: "13px var(--font-mono)",
                  background: "var(--surface-0)",
                  color: "var(--color-text)",
                }}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="ghost" size="sm" onClick={closePanel} style={{ flex: 1 }}>
                Cancelar
              </Button>
              <Button variant="primary" size="sm" onClick={handleSave} disabled={saving || !token.trim()} style={{ flex: 1 }}>
                {saving ? "Salvando..." : "Salvar"}
              </Button>
            </div>
          </div>
        )}
      </SidePanel>
    </div>
  );
}

/* --- CRM provider card --- */

interface CrmProviderCardProps {
  name: string;
  description: string;
  connection?: CrmConnectionDTO;
  comingSoon?: boolean;
  onConnect?: () => void;
  onDisconnect?: (id: string) => void;
}

function CrmProviderCard({ name, description, connection, comingSoon, onConnect, onDisconnect }: CrmProviderCardProps) {
  const isConnected = connection?.status === "connected";

  const statusInfo = comingSoon
    ? { bg: "var(--color-brand-subtle)", color: "var(--color-brand)", label: "Em breve" }
    : isConnected
      ? { bg: "var(--color-success-bg)", color: "var(--color-success)", label: "Conectado" }
      : { bg: "var(--surface-2)", color: "var(--color-text-faint)", label: "Não conectado" };

  return (
    <div style={{
      border: `1px solid ${isConnected ? "var(--color-success)" : "var(--color-border)"}`,
      borderRadius: "var(--radius-md)",
      padding: 20,
      background: "var(--surface-1)",
      display: "flex",
      flexDirection: "column",
      gap: 12,
      opacity: comingSoon ? 0.7 : 1,
    }}>
      {/* Header with icon + status */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: "var(--radius-sm)", background: isConnected ? "var(--color-success-bg)" : "var(--surface-2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ExternalLink size={16} style={{ color: isConnected ? "var(--color-success)" : "var(--color-text-muted)" }} />
          </div>
          <span style={{ font: "600 14px var(--font-sans)", color: "var(--color-text)" }}>{name}</span>
        </div>
        <span style={{
          padding: "2px 8px",
          borderRadius: "var(--radius-full)",
          font: "600 10px var(--font-mono)",
          background: statusInfo.bg,
          color: statusInfo.color,
        }}>
          {statusInfo.label}
        </span>
      </div>

      {/* Description */}
      <p style={{ margin: 0, font: "13px var(--font-sans)", color: "var(--color-text-muted)", lineHeight: 1.5 }}>
        {description}
      </p>

      {/* Last sync */}
      {connection?.lastSyncAt && (
        <span style={{ font: "11px var(--font-mono)", color: "var(--color-text-faint)" }}>
          Último sync: {new Date(connection.lastSyncAt).toLocaleString("pt-BR")}
        </span>
      )}

      {/* Actions */}
      {!comingSoon && (
        <div style={{ display: "flex", gap: 8, marginTop: "auto" }}>
          {isConnected ? (
            <Button variant="ghost" size="sm" onClick={() => onDisconnect?.(connection!.id)}>
              <Unplug size={12} style={{ marginRight: 4 }} /> Desconectar
            </Button>
          ) : (
            <Button variant="primary" size="sm" onClick={() => onConnect?.()}>
              <Plug size={12} style={{ marginRight: 4 }} /> Conectar
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
