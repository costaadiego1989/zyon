import React from "react";
import { Bot, Shield, Activity, Zap, Globe, Clock, Plus } from "lucide-react";
import { TabBar } from "../../components/TabBar.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { StatCard } from "../overview/components/StatCard.js";
import { EmptyState } from "../../components/EmptyState.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
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

  const activeCount = vm.agents.filter((a) => a.status === "active").length;
  const totalTransactions = vm.agents.reduce((s, a) => s + (a.reputation?.transactionCount ?? 0), 0);
  const successRate = vm.agents.length > 0
    ? Math.round(vm.agents.reduce((s, a) => s + (a.reputation?.reputationScore ?? 0), 0) / vm.agents.length)
    : 0;

  return (
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">Checkout</span>
          <h1>Checkout Programável</h1>
          <p className="page-lead">Protocolo M2M para agentes compradores via API</p>
        </div>
      </header>

      {/* KPIs */}
      <div className="grid-4" style={{ gap: 14 }}>
        <StatCard
          label="Agentes"
          value={vm.agents.length}
          icon={<Bot size={16} />}
          accent="var(--color-brand)"
        />
        <StatCard
          label="Ativos"
          value={activeCount}
          icon={<Shield size={16} />}
          accent="var(--color-success)"
        />
        <StatCard
          label="Transações"
          value={totalTransactions}
          icon={<Activity size={16} />}
        />
        <StatCard
          label="Reputação"
          value={`${successRate}%`}
          icon={<Zap size={16} />}
          accent={successRate >= 80 ? "var(--color-brand)" : "var(--color-warning)"}
        />
      </div>

      {/* Tabs */}
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
