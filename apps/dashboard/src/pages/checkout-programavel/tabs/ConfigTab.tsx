import React, { useState } from "react";
import { Globe, Clock } from "lucide-react";
import { SectionHeader } from "../../../components/SectionHeader.js";
import { Button } from "../../../components/Button.js";
import { ToggleSwitch } from "../../../components/ToggleSwitch.js";
import type { M2MProtocolConfigResponse } from "../../../api/endpoints/m2m-management.js";

interface ConfigTabProps {
  config: M2MProtocolConfigResponse;
  saving: boolean;
  onSave: (data: Partial<M2MProtocolConfigResponse>) => Promise<void>;
}

export function ConfigTab({ config, saving, onSave }: ConfigTabProps) {
  const [enabled, setEnabled] = useState(config.enabled);
  const [webhookUrl, setWebhookUrl] = useState(config.webhookUrl ?? "");
  const [ttl, setTtl] = useState(config.maxSessionTtlMinutes);
  const [dirty, setDirty] = useState(false);

  function handleChange<T>(setter: (v: T) => void) {
    return (value: T) => { setter(value); setDirty(true); };
  }

  async function handleSave() {
    await onSave({ enabled, webhookUrl: webhookUrl.trim() || null, maxSessionTtlMinutes: ttl });
    setDirty(false);
  }

  return (
    <div className="panel" style={{ padding: "20px 24px" }}>
      <SectionHeader variant="secondary" title="Protocolo M2M" />

      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ font: "500 13px var(--font-sans)", color: "var(--color-text)" }}>Habilitar protocolo</div>
            <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 2 }}>
              Permite agentes externos realizarem checkout via API
            </div>
          </div>
          <ToggleSwitch checked={enabled} onChange={handleChange(setEnabled)} />
        </div>

        <div>
          <label style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Globe size={12} /> Webhook URL
          </label>
          <input
            type="url"
            placeholder="https://seu-sistema.com/webhooks/m2m"
            value={webhookUrl}
            onChange={(e) => handleChange(setWebhookUrl)(e.target.value)}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border)",
              background: "var(--surface-1)",
              color: "var(--color-text)",
              font: "13px var(--font-mono)",
            }}
          />
          <div style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)", marginTop: 4 }}>
            Eventos: m2m.session.started, m2m.negotiation.completed, m2m.checkout.completed
          </div>
        </div>

        <div>
          <label style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
            <Clock size={12} /> TTL da sessão (minutos)
          </label>
          <input
            type="number"
            min={1}
            max={1440}
            value={ttl}
            onChange={(e) => handleChange(setTtl)(Number(e.target.value))}
            style={{
              width: 120,
              padding: "8px 12px",
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--color-border)",
              background: "var(--surface-1)",
              color: "var(--color-text)",
              font: "13px var(--font-mono)",
            }}
          />
        </div>

        {dirty && (
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Salvando..." : "Salvar configuração"}
          </Button>
        )}
      </div>
    </div>
  );
}
