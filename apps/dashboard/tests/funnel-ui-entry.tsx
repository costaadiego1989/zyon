import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { ChartNoAxesCombined, Filter, UsersRound } from "lucide-react";
import { MarketingFunnelOverview } from "../src/pages/marketing/MarketingFunnelOverview.js";
import { CampaignDeliveryMetrics } from "../src/pages/marketing/CampaignMetrics.js";
import { FunnelChart } from "../src/pages/funnel/components/FunnelChart.js";
import { TabBar } from "../src/components/TabBar.js";
import { Button } from "../src/components/Button.js";
import type { MarketingFunnel } from "../src/api/marketing.js";
import "../src/styles.css";
import "../src/components/dashboard-ui.css";
import "../src/pages/marketing/marketing.css";
import "../src/pages/funnel/funnel-page.css";

const snapshot: MarketingFunnel = {
  total: 100,
  rows: [
    { stage: "new", origin: "whatsapp", total: 30 },
    { stage: "new", origin: "site", total: 8 },
    { stage: "interested", origin: "whatsapp", total: 18 },
    { stage: "interested", origin: "site", total: 6 },
    { stage: "shopping", origin: "whatsapp", total: 9 },
    { stage: "shopping", origin: "site", total: 3 },
    { stage: "payment_pending", origin: "whatsapp", total: 7 },
    { stage: "payment_pending", origin: "site", total: 1 },
    { stage: "purchased", origin: "whatsapp", total: 8 },
    { stage: "purchased", origin: "site", total: 5 },
    { stage: "purchased", origin: "unknown", total: 3 },
    { stage: "lost", origin: "site", total: 2 },
  ],
};
const steps = [
  {
    name: "checkout_started",
    label: "Início do checkout",
    count: 100,
    percentage: 100,
  },
  {
    name: "coupon_applied",
    label: "Cupom aplicado (opcional)",
    count: 0,
    percentage: 0,
  },
  {
    name: "shipping_selected",
    label: "Frete selecionado",
    count: 60,
    percentage: 60,
  },
  {
    name: "payment_started",
    label: "Pagamento iniciado",
    count: 70,
    percentage: 70,
  },
  {
    name: "order_completed",
    label: "Pedido confirmado",
    count: 12,
    percentage: 12,
  },
];
function App() {
  const [tab, setTab] = useState("marketing"),
    [stage, setStage] = useState(""),
    [origin, setOrigin] = useState("");
  const [funnel, setFunnel] = useState<MarketingFunnel | null>(snapshot);
  return (
    <main
      className="dashboard-ui page-container"
      style={{ padding: 24, minWidth: 0 }}
    >
      <TabBar
        label="Prévia dos componentes"
        tabs={[
          { key: "marketing", label: "Marketing", icon: <UsersRound /> },
          { key: "conversion", label: "Conversão", icon: <Filter /> },
          {
            key: "delivery",
            label: "Resultados",
            icon: <ChartNoAxesCombined />,
          },
        ]}
        activeTab={tab}
        onTabChange={setTab}
      />
      {tab === "marketing" ? (
        <>
          <MarketingFunnelOverview
            funnel={funnel}
            selectedStage={stage}
            selectedOrigin={origin}
            onStageSelect={(key) => setStage(key === stage ? "" : key)}
            onOriginSelect={(key) => setOrigin(key === origin ? "" : key)}
          />
          <p role="status">
            Etapa: {stage || "todas"} · Origem: {origin || "todas"}
          </p>
          <div>
            <Button
              onClick={() =>
                setFunnel({
                  ...snapshot,
                  total: 101,
                  rows: snapshot.rows.map((row, index) =>
                    index ? row : { ...row, total: 31 }
                  ),
                })
              }
            >
              Atualizar dados
            </Button>
            <Button onClick={() => setFunnel({ total: 0, rows: [] })}>
              Sem contatos
            </Button>
            <Button onClick={() => setFunnel(null)}>Dados indisponíveis</Button>
          </div>
        </>
      ) : tab === "conversion" ? (
        <div className="funnel-page">
          <FunnelChart
            steps={steps}
            transitions={[
              {
                from: "checkout_started",
                to: "shipping_selected",
                rate: 60,
                dropOff: 40,
                avgTimeSeconds: 1,
              },
              {
                from: "coupon_applied",
                to: "shipping_selected",
                rate: 0,
                dropOff: 0,
                avgTimeSeconds: 0,
              },
              {
                from: "shipping_selected",
                to: "payment_started",
                rate: 116.7,
                dropOff: -16.7,
                avgTimeSeconds: 1,
              },
              {
                from: "payment_started",
                to: "order_completed",
                rate: 17.1,
                dropOff: 82.9,
                avgTimeSeconds: 1,
              },
            ]}
          />
        </div>
      ) : (
        <CampaignDeliveryMetrics
          report={{
            selected: 12,
            eligible: 10,
            reservedCents: 200,
            attributedRevenueCents: null,
            counts: {
              queued: 2,
              accepted: 2,
              delivered: 3,
              read: 1,
              failed: 1,
              unknown: 1,
            },
          }}
          labels={{
            queued: "Na fila",
            accepted: "Aceitas pelo provedor",
            delivered: "Entregues",
            read: "Lidas",
            failed: "Falhas",
            unknown: "Resultado incerto",
          }}
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
