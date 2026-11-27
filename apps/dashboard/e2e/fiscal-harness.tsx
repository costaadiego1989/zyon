import React from "react";
import { createRoot } from "react-dom/client";
import { FiscalSettingsPage } from "../src/pages/fiscal/FiscalSettingsPage.js";
import { FiscalInvoicesPage } from "../src/pages/fiscal/FiscalInvoicesPage.js";
import { FiscalInvoiceDetail } from "../src/pages/fiscal/FiscalInvoiceDetail.js";
import "../src/styles.css";
import "../src/components/dashboard-ui.css";
const params = new URLSearchParams(location.search);
createRoot(document.getElementById("root")!).render(
  <main style={{ padding: 24 }}>
    {params.get("screen") === "detail" ? (
      <FiscalInvoiceDetail
        apiBaseUrl="/v1"
        merchantId={params.get("anonymous") ? null : "merchant-a"}
        intentId="intent-a"
        environment="homologation"
        onSettings={() => {
          location.hash = "fiscal-settings";
        }}
      />
    ) : params.get("screen") === "list" ? (
      <FiscalInvoicesPage
        apiBaseUrl="/v1"
        merchantId={params.get("anonymous") ? null : "merchant-a"}
        onOpen={(id, environment) => {
          location.hash = `fiscal-detail?intentId=${encodeURIComponent(
            id
          )}&environment=${environment}`;
        }}
      />
    ) : (
      <FiscalSettingsPage
        apiBaseUrl="/v1"
        merchantId={params.get("anonymous") ? null : "merchant-a"}
      />
    )}
  </main>
);
