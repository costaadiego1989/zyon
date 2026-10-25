import React, { useState, useEffect } from "react";
import { SectionHeader } from "../../../components/SectionHeader.js";
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

  useEffect(() => {
    setEnabled(config.enabled);
    setWebhookUrl(config.webhookUrl ?? "");
    setTtl(config.maxSessionTtlMinutes);
    setDirty(false);
  }, [config]);

  function markDirty() { setDirty(true); }

  async function handleSave() {
    await onSave({ enabled, webhookUrl: webhookUrl.trim() || null, maxSessionTtlMinutes: ttl });
    setDirty(false);
  }

  return (
    <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <SectionHeader variant="secondary" title="Protocolo M2M" />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ font: "500 13px var(--font-sans)", color: "var(--color-text)" }}>Habilitar protocolo</span>
          <span style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)" }}>
            Permite agentes externos completarem checkout via API
          </span>
        </div>
        <ToggleSwitch checked={enabled} onChange={(v) => { setEnabled(v); markDirty(); }} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          Webhook URL
        </label>
        <input
          type="url"
          placeholder="https://seu-sistema.com/webhooks/m2m"
          value={webhookUrl}
          onChange={(e) => { setWebhookUrl(e.target.value); markDirty(); }}
          style={{
            width: "100%",
            padding: "10px 14px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-border)",
            background: "var(--surface-2)",
            color: "var(--color-text)",
            font: "13px var(--font-mono)",
          }}
        />
        <span style={{ font: "11px var(--font-sans)", color: "var(--color-text-faint)" }}>
          Eventos: m2m.session.started · m2m.negotiation.completed · m2m.checkout.completed
        </span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <label style={{ font: "600 11px var(--font-mono)", color: "var(--color-text-muted)", letterSpacing: "0.04em", textTransform: "uppercase" }}>
          TTL da sessão (minutos)
        </label>
        <input
          type="number"
          min={1}
          max={1440}
          value={ttl}
          onChange={(e) => { setTtl(Number(e.target.value)); markDirty(); }}
          style={{
            width: 140,
            padding: "10px 14px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid var(--color-border)",
            background: "var(--surface-2)",
            color: "var(--color-text)",
            font: "13px var(--font-mono)",
          }}
        />
      </div>

      {dirty && (
        <button
          type="button"
          className="zyn-btn zyn-btn--primary"
          onClick={handleSave}
          disabled={saving}
          style={{ alignSelf: "flex-start" }}
        >
          {saving ? "Salvando..." : "Salvar configuração"}
        </button>
      )}
    </div>
  );
}
