import "./support-settings.css";
import { PageHeader } from "../../components/PageHeader.js";
import React, { useMemo, useState } from "react";
import { Plus, RefreshCw, Save } from "lucide-react";
import { Button } from "../../components/Button.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { TabBar } from "../../components/TabBar.js";
import { showToast } from "../../components/Toast.js";
import type { MerchantProfile as MerchantMeProfile } from "../../api-client.js";
import { createDashboardApi } from "../../api-client.js";
import { SupportFaqTab } from "./tabs/SupportFaqTab.js";
import { SupportTicketsTab } from "./tabs/SupportTicketsTab.js";
import { useSupportSocket } from "../../hooks/useSupportSocket.js";

type Tab = "faq" | "tickets";

const TABS = [
  { key: "tickets" as const, label: "Chamados" },
  { key: "faq" as const, label: "Perguntas frequentes" },
];

export function SupportSettingsPage(props: { apiBaseUrl: string; me: MerchantMeProfile | null }) {
  const api = useMemo(() => createDashboardApi({ baseUrl: props.apiBaseUrl }), [props.apiBaseUrl]);
  const [activeTab, setActiveTab] = useState<Tab>("tickets");
  const socket = useSupportSocket(props.apiBaseUrl, props.me?.id);

  if (!props.me) {
    return (
      <div className="dashboard-content">
        <PageHeader title="Atendimento" description="Login necessário para configurar o atendimento" />
      </div>
    );
  }

  return (
    <div className="page-container support-page">
      <PageHeader title="Atendimento" description="Acompanhe os chamados dos compradores e prepare as respostas da sua equipe." />

      <TabBar tabs={TABS} activeTab={activeTab} onTabChange={(k) => setActiveTab(k as Tab)} />

      <div hidden={activeTab !== "faq"}><SupportFaqTab api={api} /></div>
      <div hidden={activeTab !== "tickets"}><SupportTicketsTab api={api} socket={socket} /></div>
    </div>
  );
}
