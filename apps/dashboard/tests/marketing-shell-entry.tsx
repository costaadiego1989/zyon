import React from "react";
import { createRoot } from "react-dom/client";
import { DashboardShell } from "../src/shell/DashboardShell.js";
import "../src/styles.css";
import { ApiContext, useApiInstance } from "../src/hooks/useApi.js";
const query = new URLSearchParams(location.search);
function App() {
  const api = useApiInstance(query.get("api")!);
  return (
    <ApiContext.Provider value={api}>
      <DashboardShell
        me={{
          id: query.get("merchant")!,
          name: "Loja Local",
          role: "OWNER",
          user_id: query.get("user")!,
          plan: "BOTH",
        }}
        initialTab="marketing"
        onLogout={() => {}}
        onboardingCompleted
      />
    </ApiContext.Provider>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
