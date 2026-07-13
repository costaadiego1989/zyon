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
      <div>
        <div style={{ marginBottom: 20 }}>
          <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>NEGOCIAÇÃO M2M</div>
          <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Política de Negociação</h1>
          <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Configure regras de negociação automática. O agente usa essas regras para oferecer descontos e condições especiais.</div>
        </div>
        <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 40, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center", color: "var(--muted)" }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "var(--bg)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)" }}>
            <FlaskConical size={22} aria-hidden="true" />
          </div>
          <h3 style={{ font: "600 15px var(--sans)", color: "var(--ink)", margin: 0 }}>Autenticação necessária</h3>
          <p style={{ margin: 0, font: "13px var(--sans)" }}>Login obrigatório para acessar o motor de negociação.</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <div style={{ font: "600 10px var(--mono)", letterSpacing: "0.06em", color: "var(--faint)", marginBottom: 4 }}>NEGOCIAÇÃO M2M</div>
        <h1 style={{ font: "700 22px var(--serif)", color: "var(--ink)", letterSpacing: "-0.02em", marginBottom: 6 }}>Política de Negociação</h1>
        <div style={{ font: "17px var(--serif)", fontStyle: "italic", color: "var(--muted)" }}>Configure regras de negociação automática. O agente usa essas regras para oferecer descontos e condições especiais.</div>
      </div>

      <nav role="tablist" aria-label="Seções de negociação automática" style={{ display: "flex", gap: 4, marginBottom: 20, background: "var(--bg)", borderRadius: 10, padding: 4, width: "fit-content" }}>
        {(["overview", "policy", "simulator"] as const).map((key) => {
          const labels = { overview: "Sessões e custos", policy: "Regras de negociação", simulator: "Testar cenários" };
          const active = activeTab === key;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setActiveTab(key)}
              style={{ padding: "8px 16px", borderRadius: 8, border: "none", font: "600 12px var(--sans)", cursor: "pointer", background: active ? "var(--card)" : "transparent", color: active ? "var(--ink)" : "var(--faint)", boxShadow: active ? "0 1px 3px rgba(0,0,0,0.25)" : "none", transition: "all 0.15s" }}
            >
              {labels[key]}
            </button>
          );
        })}
      </nav>

      {activeTab === "overview" && <NegotiationOverviewTab api={api} />}
      {activeTab === "policy" && <NegotiationPolicyTab api={api} />}
      {activeTab === "simulator" && <NegotiationSimulatorTab api={api} />}
    </div>
  );
}
