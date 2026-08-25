import React, { useState } from "react";
import { Package, AlertTriangle, Truck, MapPin } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { TabBar } from "../../components/TabBar.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { StatCard } from "../overview/components/StatCard.js";
import { useInventoryPage } from "./useInventoryPage.js";

export interface InventoryPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

export function InventoryPage(props: InventoryPageProps) {
  const [tab, setTab] = useState<"overview" | "movements" | "alerts" | "erp">("overview");
  const vm = useInventoryPage({ me: props.me });

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <span className="eyebrow">Loja</span>
          <h1>Estoque</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  return (
    <>
      <header className="page-head">
        <div>
          <span className="eyebrow">Loja</span>
          <h1>Estoque</h1>
        </div>
      </header>

      <div className="page-tabs">
        <TabBar
          tabs={[
            { key: "overview", label: "Visão geral" },
            { key: "movements", label: "Movimentações" },
            { key: "alerts", label: "Alertas" },
            { key: "erp", label: "ERP" },
          ]}
          activeTab={tab}
          onTabChange={(t: string) => setTab(t as any)}
        />
      </div>

      <div className="page-content">
        {tab === "overview" && (
          <>
            <div className="stat-cards-row" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px", marginBottom: "32px" }}>
              <StatCard
                icon={<Package />}
                label="SKUs em catálogo"
                value={vm.summary?.totalSkus ?? 0}
              />
              <StatCard
                icon={<AlertTriangle />}
                label="Estoque baixo"
                value={vm.summary?.lowStockCount ?? 0}
              />
              <StatCard
                icon={<Truck />}
                label="Sem estoque"
                value={vm.summary?.outOfStockCount ?? 0}
              />
              <StatCard
                icon={<MapPin />}
                label="Locais de estoque"
                value={vm.locations?.length ?? 0}
              />
            </div>

            <SectionHeader title="Produtos" />
            {vm.loading ? (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--color-text-faint)" }}>
                Carregando...
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "var(--color-text-faint)" }}>SKU</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "var(--color-text-faint)" }}>Produto</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "var(--color-text-faint)" }}>Quantidade</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "var(--color-text-faint)" }}>Reservado</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "var(--color-text-faint)" }}>Local</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.items.map((item) => (
                      <tr key={item.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                        <td style={{ padding: "12px", fontSize: "13px" }}>{item.sku}</td>
                        <td style={{ padding: "12px", fontSize: "13px" }}>{item.productName}</td>
                        <td style={{ padding: "12px", fontSize: "13px" }}>{item.quantity}</td>
                        <td style={{ padding: "12px", fontSize: "13px" }}>{item.reserved}</td>
                        <td style={{ padding: "12px", fontSize: "13px" }}>{item.locationName}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === "movements" && (
          <>
            <SectionHeader title="Histórico de movimentações" />
            {vm.loading ? (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--color-text-faint)" }}>
                Carregando...
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "var(--color-text-faint)" }}>Data</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "var(--color-text-faint)" }}>SKU</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "var(--color-text-faint)" }}>Tipo</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "var(--color-text-faint)" }}>Qtd</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "var(--color-text-faint)" }}>Origem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.movements.map((m) => (
                      <tr key={m.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                        <td style={{ padding: "12px", fontSize: "13px" }}>{new Date(m.createdAt).toLocaleDateString("pt-BR")}</td>
                        <td style={{ padding: "12px", fontSize: "13px" }}>{m.sku}</td>
                        <td style={{ padding: "12px", fontSize: "13px" }}>{m.kind}</td>
                        <td style={{ padding: "12px", fontSize: "13px" }}>{m.quantity}</td>
                        <td style={{ padding: "12px", fontSize: "13px" }}>{m.source}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === "alerts" && (
          <>
            <SectionHeader title="Alertas de estoque" />
            {vm.loading ? (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--color-text-faint)" }}>
                Carregando...
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "var(--color-text-faint)" }}>SKU</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "var(--color-text-faint)" }}>Mensagem</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "var(--color-text-faint)" }}>Severidade</th>
                      <th style={{ padding: "12px", textAlign: "left", fontSize: "12px", fontWeight: 600, color: "var(--color-text-faint)" }}>Data</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vm.alerts.map((a) => (
                      <tr key={a.id} style={{ borderBottom: "1px solid var(--color-border)" }}>
                        <td style={{ padding: "12px", fontSize: "13px" }}>{a.sku}</td>
                        <td style={{ padding: "12px", fontSize: "13px" }}>{a.message}</td>
                        <td style={{ padding: "12px", fontSize: "13px" }}>{a.severity}</td>
                        <td style={{ padding: "12px", fontSize: "13px" }}>{new Date(a.createdAt).toLocaleDateString("pt-BR")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {tab === "erp" && (
          <div style={{ padding: "40px 20px", textAlign: "center" }}>
            <p style={{ color: "var(--color-text-faint)" }}>
              Conectores ERP em breve — Bling, Tiny, Omie
            </p>
          </div>
        )}
      </div>
    </>
  );
}
