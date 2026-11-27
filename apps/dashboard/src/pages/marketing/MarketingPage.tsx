import React, { useState } from "react";
import type { MerchantProfile } from "../../api-client.js";
import { normalizeRole } from "../../lib/auth/roles.js";
import { PageHeader } from "../../components/PageHeader.js";
import { TabBar } from "../../components/TabBar.js";
import { ContactsPanel } from "./ContactsPanel.js";
import { CampaignsPanel } from "./CampaignsPanel.js";
import { MarketingSettingsPanel } from "./MarketingSettingsPanel.js";
import "./marketing.css";

export function MarketingPage({
  apiBaseUrl,
  me,
  onConversation,
  initialTab,
  initialContactId,
}: {
  apiBaseUrl: string;
  me: MerchantProfile | null;
  onConversation?: (id: string) => void;
  initialTab?: "contacts" | "campaigns" | "settings";
  initialContactId?: string;
}) {
  const [tab, setTab] = useState(initialTab ?? "contacts");
  const role = normalizeRole(me?.role);
  const approver = role === "OWNER" || role === "ADMIN";
  const active = approver ? tab : "contacts";
  const tabs = [
    { key: "contacts", label: "Contatos e funil" },
    ...(approver
      ? [
          { key: "campaigns", label: "Campanhas" },
          { key: "settings", label: "Configurações" },
        ]
      : []),
  ];
  return (
    <div className="page-container marketing-page">
      <PageHeader
        title="Marketing"
        description="Acompanhe contatos, oportunidades e comunicações da sua loja."
      />
      <TabBar
        tabs={tabs}
        activeTab={active}
        onTabChange={(key) => {
          if (key === "contacts" || key === "campaigns" || key === "settings")
            setTab(key);
        }}
        label="Áreas de marketing"
      />
      {active === "contacts" ? (
        <ContactsPanel
          apiBaseUrl={apiBaseUrl}
          onConversation={onConversation}
          initialContactId={initialContactId}
        />
      ) : active === "campaigns" ? (
        <CampaignsPanel
          apiBaseUrl={apiBaseUrl}
          onSettings={() => setTab("settings")}
        />
      ) : (
        <MarketingSettingsPanel apiBaseUrl={apiBaseUrl} />
      )}
    </div>
  );
}
