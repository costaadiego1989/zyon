import React, { useMemo, useState } from "react";
import { FlaskConical } from "lucide-react";
import type { MerchantProfile as MerchantMeProfile } from "../api-client.js";
import { createDashboardApi } from "../api-client.js";
import { NegotiationOverviewTab } from "./negotiation/NegotiationOverviewTab.js";
import { NegotiationPolicyTab } from "./negotiation/NegotiationPolicyTab.js";
import { NegotiationSimulatorTab } from "./negotiation/NegotiationSimulatorTab.js";

type ActiveTab = "overview" | "policy" | "simulator";

export function NegotiationPage(props: { apiBaseUrl: string; me: MerchantMeProfile | null }) {
  const [activeTab, setActiveTab] = useState<ActiveTab>("overview");
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);

  if (!props.me) {
    return (
      <div className="dashboard-content">
        <div className="empty-state">
          <div className="empty-state-icon"><FlaskConical size={22} /></div>
          <h3>Autenticação necessária</h3>
          <p>Login obrigatório para acessar o motor de negociação.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      <header className="page-head">
        <div>
          <span className="eyebrow">Atendimento</span>
          <h1>Motor de Negociação M2M</h1>
          <p className="page-lead">
            Gerencie a política de negociação automatizada, acompanhe sessões e custos de IA,
            e teste o motor de avaliação.
          </p>
        </div>
      </header>

      <nav className="page-tabs" role="tablist" aria-label="Seções de negociação">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "overview"}
          className={`page-tab ${activeTab === "overview" ? "active" : ""}`}
          onClick={() => setActiveTab("overview")}
        >
          Visão Geral
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "policy"}
          className={`page-tab ${activeTab === "policy" ? "active" : ""}`}
          onClick={() => setActiveTab("policy")}
        >
          Política
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "simulator"}
          className={`page-tab ${activeTab === "simulator" ? "active" : ""}`}
          onClick={() => setActiveTab("simulator")}
        >
          Simulador
        </button>
      </nav>

      {activeTab === "overview" && <NegotiationOverviewTab api={api} />}
      {activeTab === "policy" && <NegotiationPolicyTab api={api} />}
      {activeTab === "simulator" && <NegotiationSimulatorTab api={api} />}
    </div>
  );
}
