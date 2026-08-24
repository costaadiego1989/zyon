import React from "react";
import { TabBar } from "../../components/TabBar.js";
import { useCheckoutProgramavel } from "./useCheckoutProgramavel.js";
import { ConfigTab } from "./tabs/ConfigTab.js";
import { AgentsTab } from "./tabs/AgentsTab.js";
import type { MerchantProfile } from "../../api-client.js";

const TABS = [
  { key: "config" as const, label: "Configuração" },
  { key: "agents" as const, label: "Agentes" },
] as const;

export function CheckoutProgramavelPage({ me }: { apiBaseUrl: string; me: MerchantProfile | null }) {
  const vm = useCheckoutProgramavel();

  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">Checkout</span>
          <h1>Checkout Programável</h1>
          <p className="page-lead">Gerencie o protocolo M2M e agentes compradores que interagem via API</p>
        </div>
      </header>

      <TabBar
        tabs={TABS.map((t) => ({ key: t.key, label: t.label }))}
        activeTab={vm.tab}
        onTabChange={(k) => vm.setTab(k as any)}
      />

      {vm.tab === "config" && (
        <ConfigTab config={vm.config} saving={vm.saving} onSave={vm.handleSaveConfig} />
      )}

      {vm.tab === "agents" && (
        <AgentsTab
          agents={vm.agents}
          loading={vm.loading}
          saving={vm.saving}
          onCreate={vm.handleCreateAgent}
          onSuspend={vm.handleSuspendAgent}
        />
      )}
    </div>
  );
}
