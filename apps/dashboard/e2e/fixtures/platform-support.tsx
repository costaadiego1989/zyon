import React from "react";
import { createRoot } from "react-dom/client";
import { PlatformFeedbackFab } from "../../src/components/PlatformFeedbackFab.js";
import { ApiContext } from "../../src/hooks/useApi.js";
import { createDashboardApi } from "../../src/api-client.js";
import "../../src/styles.css";

// This fixture mounts the production entry point for support against the real
// isolated API. It supplies no intercepted API responses or fake chat state.
const fixture = JSON.parse(sessionStorage.getItem("support.fixture") ?? "null") as { api: string; merchantId: string } | null;
if (!fixture) throw new Error("Local support fixture session required");
const api = createDashboardApi({ baseUrl: fixture.api });
createRoot(document.getElementById("root")!).render(<ApiContext.Provider value={api}><main style={{ padding: 48 }}><h1>Painel da loja</h1><p>Validação local do atendimento técnico com os componentes de produção.</p></main><PlatformFeedbackFab apiBaseUrl={fixture.api} merchantId={fixture.merchantId} /></ApiContext.Provider>);
