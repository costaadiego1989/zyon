import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import {
  UsersRound,
  Megaphone,
  Settings2,
  ListFilter,
  CircleCheck,
} from "lucide-react";
import { TabBar } from "../src/components/TabBar.js";
import { FilterToolbar } from "../src/components/FilterToolbar.js";
import { PeriodSelector } from "../src/pages/overview/components/PeriodSelector.js";
import "../src/styles.css";
import "../src/components/dashboard-ui.css";

function SharedTabs() {
  const [tab, setTab] = useState("contacts");
  const [filter, setFilter] = useState("all");
  const [period, setPeriod] = useState<"today" | "7d" | "30d" | "90d">("today");
  return (
    <main className="dashboard-ui page-container" style={{ padding: 24 }}>
      <h1>Abas e filtros</h1>
      <TabBar
        label="Áreas"
        tabs={[
          {
            key: "contacts",
            label: "Contatos e funil",
            icon: <UsersRound />,
            panelId: "contacts",
          },
          {
            key: "campaigns",
            label: "Campanhas",
            icon: <Megaphone />,
            panelId: "campaigns",
          },
          {
            key: "settings",
            label: "Configurações de comunicação",
            icon: <Settings2 />,
            panelId: "settings",
          },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />
      <section id={tab} role="tabpanel" aria-labelledby={`${tab}-tab`}>
        Área: {tab}
      </section>
      <FilterToolbar
        tabs={[
          { key: "all", label: "Todos", icon: <ListFilter /> },
          { key: "active", label: "Ativos", icon: <CircleCheck /> },
        ]}
        activeTab={filter}
        onTabChange={setFilter}
      />
      <p role="status">Filtro: {filter}</p>
      <PeriodSelector value={period} onChange={setPeriod} />
      <p>Período: {period}</p>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<SharedTabs />);
