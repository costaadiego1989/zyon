import React from "react";
import { createRoot } from "react-dom/client";
import { FunnelPage } from "../src/pages/funnel/FunnelPage.js";
import { ApiContext, useApiInstance } from "../src/hooks/useApi.js";
import "../src/styles.css";
import "../src/components/dashboard-ui.css";
const query = new URLSearchParams(location.search);
function App() {
  const api = useApiInstance(query.get("api")!);
  return (
    <ApiContext.Provider value={api}>
      <main
        className="dashboard-ui"
        style={{
          maxWidth: 1130,
          padding: 24,
          marginInline: "auto",
          minWidth: 0,
        }}
      >
        <FunnelPage
          apiBaseUrl={query.get("api")!}
          me={{
            id: query.get("merchant")!,
            name: "Loja de validação",
            role: "OWNER",
            user_id: "local-owner",
            plan: "BOTH",
          }}
        />
      </main>
    </ApiContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
