import React, { useMemo, useState } from "react";
import { Plus, RefreshCw, Save } from "lucide-react";
import { Button } from "../../components/Button.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { showToast } from "../../components/Toast.js";
import type { MerchantProfile as MerchantMeProfile } from "../../api-client.js";
import { createDashboardApi } from "../../api-client.js";
import { SupportFaqTab } from "./tabs/SupportFaqTab.js";
import { SupportTicketsTab } from "./tabs/SupportTicketsTab.js";
import { useSupportSocket } from "../../hooks/useSupportSocket.js";

type Tab = "faq" | "tickets";

export function SupportSettingsPage(props: { apiBaseUrl: string; me: MerchantMeProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [activeTab, setActiveTab] = useState<Tab>("faq");
  const socket = useSupportSocket(props.apiBaseUrl, props.me?.id);

  if (!props.me) {
    return (
      <div className="dashboard-content">
        <header className="page-head">
          <div>
            <h1>Atendimento ao Comprador</h1>
            <p className="page-lead">Login necessário para configurar o atendimento</p>
          </div>
        </header>
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      {/* ── Page Head ── */}
      <header className="page-head">
        <div>
          <span className="eyebrow">Atendimento</span>
          <h1>Atendimento ao Comprador</h1>
          <p className="page-lead">Configure o atendimento ao comprador durante o checkout.</p>
        </div>
      </header>

      {/* ── Tab Navigation ── */}
      <div style={{ display: "flex", gap: 8, marginBottom: "var(--space-5)", borderBottom: "1px solid var(--color-border)", paddingBottom: "var(--space-3)" }}>
        <button
          type="button"
          onClick={() => setActiveTab("faq")}
          style={{
            padding: "var(--space-2) var(--space-3)",
            fontSize: 14,
            fontWeight: activeTab === "faq" ? 700 : 500,
            color: activeTab === "faq" ? "var(--color-brand)" : "var(--color-text-muted)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            borderBottom: activeTab === "faq" ? "2px solid var(--color-brand)" : "none",
            marginBottom: -13,
          }}
        >
          FAQ automático
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("tickets")}
          style={{
            padding: "var(--space-2) var(--space-3)",
            fontSize: 14,
            fontWeight: activeTab === "tickets" ? 700 : 500,
            color: activeTab === "tickets" ? "var(--color-brand)" : "var(--color-text-muted)",
            background: "transparent",
            border: "none",
            cursor: "pointer",
            borderBottom: activeTab === "tickets" ? "2px solid var(--color-brand)" : "none",
            marginBottom: -13,
          }}
        >
          Escalonamento
        </button>
      </div>

      {/* ── Tab Content ── */}
      {activeTab === "faq" && <SupportFaqTab api={api} />}
      {activeTab === "tickets" && <SupportTicketsTab api={api} socket={socket} />}
    </div>
  );
}
