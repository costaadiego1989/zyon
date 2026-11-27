import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { FiscalSettingsPage } from "../src/pages/fiscal/FiscalSettingsPage.js";
import { FiscalInvoicesPage } from "../src/pages/fiscal/FiscalInvoicesPage.js";
import { fiscalHash } from "../src/shell/fiscal-navigation.js";
import "../src/styles.css";
import "../src/components/dashboard-ui.css";

function Fixture() {
  const [merchant, setMerchant] = useState("merchant-a");
  const [screen, setScreen] = useState(new URLSearchParams(location.search).get("screen"));
  (window as any).fiscalUiFixture = { setMerchant };
  return <main style={{ padding: 16, minWidth: 0 }}>{screen === "invoices"
    ? <FiscalInvoicesPage apiBaseUrl="/v1" merchantId={merchant} initialEnvironment="homologation"
        onSettings={() => { location.hash = fiscalHash("fiscal-settings", "homologation"); setScreen("settings"); }}
        onOpen={(id, environment) => { location.hash = fiscalHash("fiscal-detail", environment, id); }} />
    : <FiscalSettingsPage apiBaseUrl="/v1" merchantId={merchant} initialEnvironment="homologation" />}</main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
