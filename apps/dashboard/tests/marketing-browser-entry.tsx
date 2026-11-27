import React from "react";
import { createRoot } from "react-dom/client";
import { ContactsPanel } from "../src/pages/marketing/ContactsPanel.js";
import { ConversationsPage } from "../src/pages/marketing/ConversationsPage.js";
import { MarketingPage } from "../src/pages/marketing/MarketingPage.js";
import { MarketingAccessGate } from "../src/pages/marketing/MarketingAccessGate.js";
import { PageHeader } from "../src/components/PageHeader.js";
import "../src/styles.css";
import "../src/components/dashboard-ui.css";

const base = new URLSearchParams(location.search).get("api")!;
const query = new URLSearchParams(location.search);
function MarketingProbe() {
  const child = (
    <MarketingPage
      apiBaseUrl={base}
      me={{
        id: "local",
        name: "Loja Local",
        user_id: query.get("user")!,
        role: query.get("role") === "staff" ? "staff" : "owner",
      }}
    />
  );
  return query.get("gated") === "true" ? (
    <MarketingAccessGate
      apiBaseUrl={base}
      canUpgrade={query.get("role") !== "staff"}
    >
      {child}
    </MarketingAccessGate>
  ) : (
    child
  );
}
createRoot(document.getElementById("root")!).render(
  <main
    className="dashboard-ui page-container"
    style={{ padding: 24, minWidth: 0 }}
  >
    <PageHeader
      title="Marketing"
      description="Contatos e relacionamento da sua loja"
    />
    {query.get("view") === "marketing" ? (
      <MarketingProbe />
    ) : query.get("view") === "conversations" ? (
      <ConversationsPage
        apiBaseUrl={base}
        me={{
          id: "local",
          name: "Loja Local",
          user_id: query.get("user")!,
          role: "owner",
        }}
      />
    ) : (
      <ContactsPanel apiBaseUrl={base} />
    )}
  </main>
);
