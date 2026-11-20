import React from "react";
import { createRoot } from "react-dom/client";
import { FiscalSettingsPage } from "../src/pages/fiscal/FiscalSettingsPage.js";

createRoot(document.getElementById("root")!).render(<React.StrictMode><FiscalSettingsPage apiBaseUrl="/v1" merchantId="merchant_fiscal_browser" /></React.StrictMode>);
