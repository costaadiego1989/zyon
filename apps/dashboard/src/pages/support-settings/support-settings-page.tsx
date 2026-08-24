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
  { key: "faq" as const, label: "FAQ automático" },
  { key: "tickets" as const, label: "Escalonamento" },
];

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
    <div className="page-container">
      <header className="page-head">
        <div>
          <span className="eyebrow">Atendimento</span>
          <h1>Atendimento ao Comprador</h1>
          <p className="page-lead">Configure o atendimento ao comprador durante o checkout.</p>
        </div>
      </header>

      <TabBar tabs={TABS} activeTab={activeTab} onTabChange={(k) => setActiveTab(k as Tab)} />

      {activeTab === "faq" && <SupportFaqTab api={api} />}
      {activeTab === "tickets" && <SupportTicketsTab api={api} socket={socket} />}
    </div>
  );
}
