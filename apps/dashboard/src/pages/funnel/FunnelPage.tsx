import React from "react";
import { Download, AlertTriangle } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { PageHeader } from "../../components/PageHeader.js";
import { TabBar } from "../../components/TabBar.js";
import { EmptyState } from "../../components/EmptyState.js";
import { Button } from "../../components/Button.js";
import { PageLoader } from "../../components/PageLoader.js";
import { PeriodFilter } from "../../components/PeriodFilter.js";
import { FilterSelect } from "../../components/FilterToolbar.js";
import {
  useFunnelPage,
  type FunnelBreakdownDimension,
} from "./useFunnelPage.js";
import { FunnelChart } from "./components/FunnelChart.js";
import { FunnelMetrics } from "./components/FunnelMetrics.js";
import { FunnelBreakdown } from "./components/FunnelBreakdown.js";
import { ActiveSessionsList } from "./components/ActiveSessionsList.js";
import { BottleneckBanner } from "./components/BottleneckBanner.js";
import "./funnel-page.css";
const PERIODS = [
  { key: "today", label: "Hoje" },
  { key: "7d", label: "7 dias" },
  { key: "30d", label: "30 dias" },
  { key: "90d", label: "90 dias" },
] as const;
export function FunnelPage({
  apiBaseUrl,
  me,
}: {
  apiBaseUrl: string;
  me: MerchantProfile;
}) {
  const vm = useFunnelPage({
    apiBaseUrl,
    merchantId: me.id,
    merchantName: me.name,
    plan: me.plan,
  });
  return (
    <div className="dashboard-content page-container funnel-page">
      <PageHeader
        title="Funil de conversão"
        description={
          <>
            {vm.funnelSource === "storefront"
              ? "Da visita ao cadastro na loja."
              : "Do início do checkout ao pagamento concluído."}{" "}
            Datas e períodos em UTC.
          </>
        }
        actions={
          <Button
            variant="outline"
            onClick={vm.exportCsv}
            disabled={!vm.data || vm.loading}
          >
            <Download size={16} /> Exportar CSV
          </Button>
        }
      />
      {vm.showSourceTabs && (
        <TabBar
          tabs={[
            { key: "storefront", label: "Jornada da loja" },
            { key: "checkout", label: "Jornada do checkout" },
          ]}
          activeTab={vm.funnelSource}
          onTabChange={(value) =>
            vm.setFunnelSource(value as "storefront" | "checkout")
          }
        />
      )}
      {vm.data && <FunnelMetrics data={vm.data} />}
      <section className="funnel-query" aria-label="Filtros do funil">
        <PeriodFilter
          presets={PERIODS}
          active={vm.dateRange.from || vm.dateRange.to ? "custom" : vm.period}
          onPreset={key => { vm.setPeriod(key as typeof vm.period); vm.setDateRange({ from: "", to: "" }); }}
          from={vm.dateRange.from}
          to={vm.dateRange.to}
          onDate={(field, value) => vm.setDateRange({ ...vm.dateRange, [field]: value })}
        />
        <div className="funnel-query-options">
          <FilterSelect
            ariaLabel="Segmentar resultados"
            value={vm.breakdown}
            onChange={value => vm.setBreakdown(value as FunnelBreakdownDimension)}
            options={[
              { value: "none", label: "Sem segmentação" },
              { value: "device", label: "Por dispositivo" },
              { value: "buyer_type", label: "Por tipo de comprador" },
              { value: "payment_method", label: "Por pagamento" },
            ]}
          />
          <label className="funnel-query-compare">
            <input type="checkbox" checked={vm.compareEnabled} onChange={event => vm.setCompareEnabled(event.target.checked)} />
            Comparar com o período anterior
          </label>
        </div>
        {(vm.dateRange.from ||
          vm.dateRange.to ||
          vm.breakdown !== "none" ||
          vm.compareEnabled) && (
          <Button
            variant="ghost"
            onClick={() => {
              vm.setDateRange({ from: "", to: "" });
              vm.setBreakdown("none");
              vm.setCompareEnabled(false);
            }}
          >
            Limpar filtros adicionais
          </Button>
        )}
      </section>
      {vm.error && (
        <EmptyState
          icon={AlertTriangle}
          title="Confira a consulta do funil"
          description={vm.error}
          action={
            <Button variant="outline" onClick={vm.refresh}>
              Tentar novamente
            </Button>
          }
        />
      )}
      {vm.loading && <PageLoader />}
      {vm.data?.bottleneck && (
        <BottleneckBanner
          bottleneck={vm.data.bottleneck}
          steps={vm.data.steps}
        />
      )}
      {vm.data && (
        <p className="funnel-reading-note">
          Cada etapa mostra a contagem e a proporção retornadas para esta
          jornada. Etapas opcionais podem ter menos ocorrências. Compare
          períodos e amostras equivalentes antes de avaliar uma mudança.
        </p>
      )}
      <div
        className={`fnl-body${vm.breakdown === "none" ? " no-breakdown" : ""}`}
      >
        {vm.data &&
          (vm.data.totalSessions === 0 ? (
            <EmptyState
              title="Nenhuma sessão neste período"
              description="Selecione outro período ou aguarde novas interações nesta jornada."
            />
          ) : (
            <FunnelChart
              steps={vm.data.steps}
              transitions={vm.data.transitions}
            />
          ))}
        {vm.data && vm.breakdown !== "none" && (
          <FunnelBreakdown
            breakdowns={vm.data.breakdowns ?? {}}
            dimension={vm.breakdown}
          />
        )}
      </div>
      {vm.sessionsError ? (
        <EmptyState
          title="Sessões indisponíveis"
          description={vm.sessionsError}
          action={
            <Button variant="outline" onClick={vm.refresh}>
              Atualizar sessões
            </Button>
          }
        />
      ) : (
        <ActiveSessionsList
          key={me.id + vm.funnelSource}
          sessions={vm.sessions}
          loading={vm.sessionsLoading}
        />
      )}
    </div>
  );
}
