import React from "react";
import { createRoot } from "react-dom/client";
import { ApiContext } from "../src/hooks/useApi.js";
import { createDashboardApi } from "../src/api-client.js";
import { RecoveryAttemptsPanel } from "../src/pages/cart-recovery/RecoveryAttemptsPanel.js";
import "../src/styles.css";
import "../src/pages/cart-recovery/cart-recovery.css";
createRoot(document.getElementById("root")!).render(<ApiContext.Provider value={createDashboardApi({ baseUrl: "/v1" })}><main className="dashboard-ui" style={{ padding: 24 }}><RecoveryAttemptsPanel /></main></ApiContext.Provider>);
