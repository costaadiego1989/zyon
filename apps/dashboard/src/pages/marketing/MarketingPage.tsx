import React, { useState } from "react";
import { UsersRound, Megaphone, SlidersHorizontal } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { normalizeRole } from "../../lib/auth/roles.js";
import { PageHeader } from "../../components/PageHeader.js";
import { TabBar } from "../../components/TabBar.js";
import { Button } from "../../components/Button.js";
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
  const [tab, setTab] = useState(
    initialTab === "campaigns" ? "campaigns" : "contacts"
  );
  const [settingsOpen, setSettingsOpen] = useState(initialTab === "settings");
  const role = normalizeRole(me?.role);
  const approver = role === "OWNER" || role === "ADMIN";
  const active = approver ? tab : "contacts";
  const tabs = [
    {
      key: "contacts",
      label: "Contatos e funil",
      icon: <UsersRound size={16} />,
    },
    ...(approver
      ? [
          {
            key: "campaigns",
            label: "Campanhas",
            icon: <Megaphone size={16} />,
          },
        ]
      : []),
  ];
  return (
    <div className="page-container marketing-page marketing-workspace">
      <PageHeader
        title="Marketing"
        description="Acompanhe contatos, oportunidades e comunicações da sua loja."
        actions={
          approver ? (
            <Button variant="outline" onClick={() => setSettingsOpen(true)}>
              <SlidersHorizontal size={16} aria-hidden="true" /> Configurações
            </Button>
          ) : undefined
        }
      />
      <TabBar
        tabs={tabs}
        activeTab={active}
        onTabChange={(key) => {
          if (key === "contacts" || key === "campaigns") setTab(key);
        }}
        label="Áreas de marketing"
      />
      {active === "contacts" ? (
        <ContactsPanel
          apiBaseUrl={apiBaseUrl}
          onConversation={onConversation}
          initialContactId={initialContactId}
        />
      ) : (
        <CampaignsPanel
          apiBaseUrl={apiBaseUrl}
          onSettings={() => setSettingsOpen(true)}
        />
      )}
      {approver && settingsOpen && (
        <MarketingSettingsPanel
          apiBaseUrl={apiBaseUrl}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  );
}
