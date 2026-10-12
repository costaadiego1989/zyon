import React, { useId, useState } from "react";
import { Brain, Target, Sparkles, Activity } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { PageHeader } from "../../components/PageHeader.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { PageLoader } from "../../components/PageLoader.js";
import { TabBar } from "../../components/TabBar.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { DataPanel } from "../../components/DataPanel.js";
import { FilterSelect } from "../../components/FilterToolbar.js";
import { StatCard } from "../overview/components/StatCard.js";
import { useIntentMemoryPage } from "./useIntentMemoryPage.js";
import "./intent-memory.css";
export interface IntentMemoryPageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}
const INTENT_LABELS: Record<string, string> = {
  price_sensitive: "Sensível a preço",
  ready_to_buy: "Pronto para comprar",
  speed_focused: "Focado em rapidez",
  browsing: "Navegando",
  exploring: "Explorando",
};
const INTENT_DESCRIPTIONS: Record<string, string> = {
  price_sensitive:
    "Há sinais de atenção ao preço ou ao custo do frete. Confira o contexto antes de propor uma oferta.",
  ready_to_buy:
    "Há sinais de avanço na compra. O perfil não garante que o pedido será concluído.",
  speed_focused:
    "Há sinais de interesse em rapidez. Destaque apenas prazos e modalidades disponíveis na loja.",
  browsing:
    "O comprador ainda está avaliando a compra. Esclareça dúvidas sem presumir uma decisão.",
  exploring:
    "Ainda não há um sinal dominante. O perfil pode mudar com novas interações.",
};
const PAIN_POINT_LABELS: Record<string, string> = {
  shipping_cost: "Preço do frete",
  price: "Preço do produto",
  payment_friction: "Dificuldade no pagamento",
  trust: "Confiança na loja",
  hesitation: "Indecisão",
};
const LEVEL_LABELS: Record<string, string> = {
  low: "Baixo",
  medium: "Médio",
  high: "Alto",
  unknown: "Não identificado",
  budget: "Econômico",
  mid: "Intermediário",
  premium: "Premium",
};
export function IntentMemoryPage(props: IntentMemoryPageProps) {
  const vm = useIntentMemoryPage({ me: props.me });
  const id = useId();
  const [tab, setTab] = useState<"overview" | "signals">("overview");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(1);
  const total = Object.values(vm.distribution).reduce((a, b) => a + b, 0),
    distTotal = total || 1;
  const dominant = Object.entries(vm.distribution).sort(
    (a, b) => b[1] - a[1]
  )[0];
  const dominantCount = dominant?.[1] ?? 0,
    dominantKey = dominantCount > 0 ? dominant?.[0] ?? "exploring" : null;
  const trackedSessions = vm.config.intent_tracking_enabled ? total : 0;
  const filtered = vm.signals.filter(
    (signal) => !filter || signal.intent === filter
  );
  const currentPage = Math.min(
    page,
    Math.max(1, Math.ceil(filtered.length / 10))
  );
  return (
    <div className="page-container intent-memory-page">
      <PageHeader
        title="Memória de intenção"
        description="Consulte sinais de preferência observados nas interações dos compradores."
      />
      {!props.me ? (
        <EmptyState
          title="Entre para consultar"
          description="Acesse sua conta para consultar os perfis da loja."
        />
      ) : vm.loading ? (
        <PageLoader />
      ) : vm.loadError ? (
        <EmptyState
          title="Perfis indisponíveis"
          description={vm.loadError}
          action={
            <Button variant="outline" onClick={vm.reload}>
              Tentar novamente
            </Button>
          }
        />
      ) : (
        <>
          <section className="panel intent-memory-setting">
            <div className="intent-memory-toggle">
              <label htmlFor={id}>
                <strong>Usar memória de intenção</strong>
                <span>
                  A configuração é salva ao alterar este controle. O uso dos
                  sinais depende da autorização do comprador.
                </span>
              </label>
              <ToggleSwitch
                id={id}
                checked={vm.config.intent_tracking_enabled}
                disabled={vm.saving}
                onChange={vm.handleToggleTracking}
              />
            </div>
            {vm.saveError && (
              <p role="alert" className="intent-memory-error">
                {vm.saveError}
              </p>
            )}
            {vm.saving && <p role="status">Salvando configuração…</p>}
          </section>
          {/* KPI Stats — using official StatCard from overview */}
          <div className="grid-4" style={{ gap: 14 }}>
            <StatCard
              icon={<Brain size={16} />}
              value={trackedSessions}
              label="Clientes analisados"
              accent="var(--color-brand)"
            />
            <StatCard
              icon={<Target size={16} />}
              value={dominantKey ? (INTENT_LABELS[dominantKey] ?? "—") : "—"}
              label="Perfil mais comum"
              accent="var(--color-brand)"
            />
            <StatCard
              icon={<Sparkles size={16} />}
              value={`${
                vm.config.intent_tracking_enabled
                  ? Object.keys(vm.distribution).filter(
                      (k) =>
                        vm.distribution[k as keyof typeof vm.distribution] > 0
                    ).length
                  : 0
              }/5`}
              label="Perfis identificados"
            />
            <StatCard
              icon={<Activity size={16} />}
              value={vm.signals.length}
              label="Clientes com perfil"
              accent="var(--color-success)"
            />
          </div>

          <p className="intent-memory-note">
            Resumo dos até 100 registros mais recentes retornados pelo serviço.
            Os perfis indicam sinais observados, não uma certeza sobre a
            intenção do comprador.
          </p>
          <TabBar
            tabs={[
              { key: "overview", label: "Perfis observados" },
              { key: "signals", label: "Atividade recente" },
            ]}
            activeTab={tab}
            onTabChange={(value) => setTab(value as "overview" | "signals")}
          />
          {tab === "overview" ? (
            <>
              <section className="panel intent-memory-section">
                <SectionHeader
                  title="Distribuição dos perfis"
                  subtitle="Participação de cada perfil nos registros consultados."
                />
                {!vm.config.intent_tracking_enabled ? (
                  <EmptyState
                    icon={Brain}
                    title="Memória de intenção desativada"
                    description="Ative a configuração acima para permitir o uso de novos sinais autorizados."
                  />
                ) : !total ? (
                  <EmptyState
                    icon={Brain}
                    title="Ainda não há perfis observados"
                    description="Os registros aparecem conforme as interações elegíveis são analisadas, com autorização do comprador."
                  />
                ) : (
                  <div className="intent-memory-distribution">
                    {Object.entries(vm.distribution).map(([key, count]) => (
                      <div key={key}>
                        <div>
                          <span>
                            {INTENT_LABELS[key] ?? "Perfil não identificado"}
                          </span>
                          <strong>
                            {count} · {Math.round((count / distTotal) * 100)}%
                          </strong>
                        </div>
                        <div className="intent-memory-track" aria-hidden="true">
                          <span
                            style={{ width: (count / distTotal) * 100 + "%" }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
              <details className="panel intent-memory-guide">
                <summary>Como interpretar os perfis</summary>
                <dl>
                  {Object.entries(INTENT_DESCRIPTIONS).map(
                    ([key, description]) => (
                      <div key={key}>
                        <dt>{INTENT_LABELS[key]}</dt>
                        <dd>{description}</dd>
                      </div>
                    )
                  )}
                </dl>
                <p>
                  As condições comerciais da loja continuam valendo. O perfil
                  não autoriza descontos ou prazos adicionais.
                </p>
              </details>
            </>
          ) : (
            <>
              <div className="intent-memory-filters">
                <FilterSelect
                  value={filter}
                  onChange={(value) => {
                    setFilter(value);
                    setPage(1);
                  }}
                  ariaLabel="Filtrar por perfil"
                  placeholder="Todos os perfis"
                  options={Object.entries(INTENT_LABELS).map(
                    ([value, label]) => ({ value, label })
                  )}
                />
                {filter && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setFilter("");
                      setPage(1);
                    }}
                  >
                    Limpar filtro
                  </Button>
                )}
              </div>
              <DataPanel
                title="Registros recentes"
                page={currentPage}
                pageSize={10}
                total={filtered.length}
                onPageChange={setPage}
                isEmpty={!filtered.length}
                empty={{
                  icon: Brain,
                  title: filter
                    ? "Nenhum registro com este perfil"
                    : "Ainda não há perfis observados",
                  description: filter
                    ? "Selecione outro perfil ou limpe o filtro."
                    : "Os registros autorizados aparecerão nesta lista.",
                  action: filter ? (
                    <Button variant="outline" onClick={() => setFilter("")}>
                      Limpar filtro
                    </Button>
                  ) : undefined,
                }}
              >
                <div className="intent-memory-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Perfil</th>
                        <th>Urgência</th>
                        <th>Faixa de orçamento</th>
                        <th>Pontos de atenção</th>
                        <th>Registrado em</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered
                        .slice((currentPage - 1) * 10, currentPage * 10)
                        .map((signal, index) => (
                          <tr key={signal.created_at + index}>
                            <td>
                              {INTENT_LABELS[signal.intent] ??
                                "Perfil não identificado"}
                            </td>
                            <td>
                              {LEVEL_LABELS[signal.urgency] ??
                                "Não identificado"}
                            </td>
                            <td>
                              {LEVEL_LABELS[signal.budget] ??
                                "Não identificado"}
                            </td>
                            <td>
                              {signal.pain_points
                                .map(
                                  (value) =>
                                    PAIN_POINT_LABELS[value] ?? "Outro sinal"
                                )
                                .join(", ") || "Nenhum registrado"}
                            </td>
                            <td>
                              {new Date(signal.created_at).toLocaleString(
                                "pt-BR"
                              )}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </DataPanel>
            </>
          )}
        </>
      )}
    </div>
  );
}
