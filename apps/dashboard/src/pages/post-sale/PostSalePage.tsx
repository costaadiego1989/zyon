import React, { useState } from "react";
import { Star, ThumbsUp, ThumbsDown, MessageCircle, CheckCircle2, Settings } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { StatCard } from "../overview/components/StatCard.js";
import { TabBar } from "../../components/TabBar.js";
import { DataPanel } from "../../components/DataPanel.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { Button } from "../../components/Button.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { usePostSalePage } from "./usePostSalePage.js";
import { usePostSaleConfig } from "./usePostSaleConfig.js";

export interface PostSalePageProps {
  apiBaseUrl: string;
  me: MerchantProfile | null;
}

export function PostSalePage(props: PostSalePageProps) {
  const vm = usePostSalePage({ me: props.me });
  const cfg = usePostSaleConfig({ me: props.me });
  const [tab, setTab] = useState<"overview" | "reviews" | "nps" | "config">("overview");

  if (!props.me) {
    return (
      <header className="page-head">
        <div>
          <span className="eyebrow">Pós-Venda</span>
          <h1>Pós-Venda</h1>
          <p className="page-lead">Login necessário</p>
        </div>
      </header>
    );
  }

  return (
    <div className="page-container">
      {/* Header */}
      <header className="page-head">
        <div>
          <span className="eyebrow">Inteligência IA</span>
          <h1 style={{ color: "var(--color-brand)" }}>Pós-Venda</h1>
          <p className="page-lead">Engajamento inteligente após a compra. Envie follow-ups personalizados, colete reviews e NPS com IA.</p>
        </div>
      </header>

      {/* Stats Row */}
      <div className="grid-4" style={{ gap: 14 }}>
        <StatCard
          icon={<MessageCircle size={16} />}
          value={vm.stats?.totalMessagesSent ?? 0}
          label="Mensagens enviadas"
          accent="var(--color-brand)"
        />
        <StatCard
          icon={<Star size={16} />}
          value={vm.stats?.totalReviewsReceived ?? 0}
          label="Reviews recebidos"
        />
        <StatCard
          icon={<ThumbsUp size={16} />}
          value={
            vm.stats?.npsByClassification
              ? `${vm.stats.npsByClassification.promoters}/${vm.stats.npsByClassification.promoters + vm.stats.npsByClassification.passives + vm.stats.npsByClassification.detractors}`
              : "0/0"
          }
          label="Promotores / Total"
          accent="var(--color-success)"
        />
        <StatCard
          icon={<CheckCircle2 size={16} />}
          value={vm.stats?.npsAverage?.toFixed(1) ?? "—"}
          label="NPS Score"
        />
      </div>

      {/* Tabs */}
      <TabBar
        tabs={[
          { key: "overview", label: "Visão geral" },
          { key: "reviews", label: `Reviews (${vm.reviews.length})` },
          { key: "nps", label: `NPS (${vm.npsItems.length})` },
          { key: "config", label: "Configurações" },
        ]}
        activeTab={tab}
        onTabChange={(k) => setTab(k as "overview" | "reviews" | "nps" | "config")}
      />

      {/* Overview Tab */}
      {tab === "overview" && (
        <div className="panel" style={{ padding: "20px 24px" }}>
          <SectionHeader title="Resumo de Atividades" variant="secondary" />
          {vm.loading ? (
            <div style={{ padding: "40px 0", textAlign: "center", color: "var(--color-text-faint)" }}>
              Carregando...
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--color-border)" }}>
                <div style={{ font: "13px var(--font-sans)", color: "var(--color-text)" }}>
                  Mensagens programadas
                </div>
                <div style={{ font: "600 13px var(--font-mono)", color: "var(--color-text)" }}>
                  {vm.stats?.totalMessagesScheduled ?? 0}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0", borderBottom: "1px solid var(--color-border)" }}>
                <div style={{ font: "13px var(--font-sans)", color: "var(--color-text)" }}>
                  Mensagens enviadas
                </div>
                <div style={{ font: "600 13px var(--font-mono)", color: "var(--color-success)" }}>
                  {vm.stats?.totalMessagesSent ?? 0}
                </div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 0" }}>
                <div style={{ font: "13px var(--font-sans)", color: "var(--color-text)" }}>
                  Taxa de entrega
                </div>
                <div style={{ font: "600 13px var(--font-mono)", color: "var(--color-text)" }}>
                  {vm.stats?.totalMessagesScheduled
                    ? `${((vm.stats.totalMessagesSent / vm.stats.totalMessagesScheduled) * 100).toFixed(0)}%`
                    : "—"}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reviews Tab */}
      {tab === "reviews" && (
        <DataPanel
          title="Reviews"
          isEmpty={vm.reviews.length === 0}
          empty={{ icon: Star, title: "Nenhum review", description: "Reviews aparecerão aqui após buyers submeterem" }}
        >
          {vm.reviews.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>
                      Avaliação
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>
                      Texto
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>
                      Status
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vm.reviews.map((review, i) => (
                    <tr key={review.id} style={{ borderBottom: i < vm.reviews.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined }}>
                      <td style={{ padding: "12px 20px", font: "500 13px var(--font-sans)" }}>
                        <span style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          {[...Array(5)].map((_, idx) => (
                            <span
                              key={idx}
                              style={{
                                width: 12,
                                height: 12,
                                background: idx < review.rating ? "var(--color-warning)" : "var(--color-border)",
                                borderRadius: 2,
                              }}
                            />
                          ))}
                        </span>
                      </td>
                      <td style={{ padding: "12px 20px", font: "12px var(--font-sans)", color: "var(--color-text-muted)", maxWidth: 200 }}>
                        {review.text || "—"}
                      </td>
                      <td style={{ padding: "12px 20px" }}>
                        <span style={{
                          padding: "2px 8px",
                          borderRadius: "var(--radius-full)",
                          font: "600 10px var(--font-mono)",
                          background: review.moderationStatus === "approved" ? "var(--color-success-bg)" : "var(--color-warning-bg)",
                          color: review.moderationStatus === "approved" ? "var(--color-success)" : "var(--color-warning)",
                        }}>
                          {review.moderationStatus === "approved" ? "Aprovado" : review.moderationStatus === "rejected" ? "Rejeitado" : "Pendente"}
                        </span>
                      </td>
                      <td style={{ padding: "12px 20px", display: "flex", gap: 6 }}>
                        {review.moderationStatus === "pending" && (
                          <>
                            <Button
                              size="sm"
                              variant="primary"
                              onClick={() => vm.handleModerateReview(review.id, "approved")}
                            >
                              Aprovar
                            </Button>
                            <Button
                              size="sm"
                              onClick={() => vm.handleModerateReview(review.id, "rejected")}
                            >
                              Rejeitar
                            </Button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataPanel>
      )}

      {/* NPS Tab */}
      {tab === "nps" && (
        <DataPanel
          title="NPS Responses"
          isEmpty={vm.npsItems.length === 0}
          empty={{ icon: ThumbsUp, title: "Sem respostas NPS", description: "NPS aparecerá aqui após buyers responderem" }}
        >
          {vm.npsItems.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>
                      Score
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>
                      Classificação
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>
                      Feedback
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "600 10px var(--font-mono)", color: "var(--color-text-faint)", textTransform: "uppercase", borderBottom: "1px solid var(--color-border)" }}>
                      Data
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vm.npsItems.map((item, i) => (
                    <tr key={item.id} style={{ borderBottom: i < vm.npsItems.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined }}>
                      <td style={{ padding: "12px 20px", font: "600 13px var(--font-mono)", color: item.score >= 9 ? "var(--color-success)" : item.score >= 7 ? "var(--color-text)" : "var(--color-error)" }}>
                        {item.score}
                      </td>
                      <td style={{ padding: "12px 20px" }}>
                        <span style={{
                          padding: "2px 8px",
                          borderRadius: "var(--radius-full)",
                          font: "600 10px var(--font-mono)",
                          background: item.classification === "promoter" ? "var(--color-success-bg)" : item.classification === "passive" ? "var(--color-warning-bg)" : "var(--color-error-bg)",
                          color: item.classification === "promoter" ? "var(--color-success)" : item.classification === "passive" ? "var(--color-warning)" : "var(--color-error)",
                        }}>
                          {item.classification === "promoter" ? "Promotor" : item.classification === "passive" ? "Neutro" : "Detrator"}
                        </span>
                      </td>
                      <td style={{ padding: "12px 20px", font: "12px var(--font-sans)", color: "var(--color-text-muted)", maxWidth: 250 }}>
                        {item.feedback || "—"}
                      </td>
                      <td style={{ padding: "12px 20px", font: "11px var(--font-mono)", color: "var(--color-text-faint)" }}>
                        {new Date(item.createdAt).toLocaleDateString("pt-BR")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DataPanel>
      )}

      {/* Config Tab */}
      {tab === "config" && (
        <div className="panel" style={{ padding: "20px 24px" }}>
          <SectionHeader title="Campanhas de Pós-Venda" variant="secondary" />
          <div style={{ display: "flex", flexDirection: "column", gap: 20, marginTop: 24 }}>
            {/* Follow-up */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>
                  Follow-up de Entrega
                </div>
                <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 4 }}>
                  Enviar mensagem após confirmação de entrega
                </div>
              </div>
              <ToggleSwitch
                checked={cfg.config.followUpEnabled}
                disabled={cfg.saving}
                onChange={(v) => cfg.update("followUpEnabled", v)}
              />
            </div>

            {/* Review */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>
                  Pedido de Review
                </div>
                <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 4 }}>
                  Agendar D+{cfg.config.reviewDelayDays}
                </div>
              </div>
              <ToggleSwitch
                checked={cfg.config.reviewEnabled}
                disabled={cfg.saving}
                onChange={(v) => cfg.update("reviewEnabled", v)}
              />
            </div>

            {/* NPS */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>
                  NPS
                </div>
                <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 4 }}>
                  Agendar D+{cfg.config.npsDelayDays}
                </div>
              </div>
              <ToggleSwitch
                checked={cfg.config.npsEnabled}
                disabled={cfg.saving}
                onChange={(v) => cfg.update("npsEnabled", v)}
              />
            </div>

            {/* Cross-sell */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>
                  Cross-sell
                </div>
                <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 4 }}>
                  Agendar D+{cfg.config.crossSellDelayDays}
                </div>
              </div>
              <ToggleSwitch
                checked={cfg.config.crossSellEnabled}
                disabled={cfg.saving}
                onChange={(v) => cfg.update("crossSellEnabled", v)}
              />
            </div>

            {/* Win-back */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>
                  Win-back com Cupom
                </div>
                <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 4 }}>
                  Scanear inativos após {cfg.config.winBackThresholdDays} dias
                </div>
              </div>
              <ToggleSwitch
                checked={cfg.config.winBackEnabled}
                disabled={cfg.saving}
                onChange={(v) => cfg.update("winBackEnabled", v)}
              />
            </div>

            {/* Loyalty */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>
                  Cupom de Fidelidade
                </div>
                <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 4 }}>
                  Marcos: {cfg.config.loyaltyMilestones}ª compra
                </div>
              </div>
              <ToggleSwitch
                checked={cfg.config.loyaltyEnabled}
                disabled={cfg.saving}
                onChange={(v) => cfg.update("loyaltyEnabled", v)}
              />
            </div>

            {/* Reorder */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ font: "600 13px var(--font-sans)", color: "var(--color-text)" }}>
                  Recompra Consumível
                </div>
                <div style={{ font: "12px var(--font-sans)", color: "var(--color-text-muted)", marginTop: 4 }}>
                  Lembrete de recompra automático
                </div>
              </div>
              <ToggleSwitch
                checked={cfg.config.reorderEnabled}
                disabled={cfg.saving}
                onChange={(v) => cfg.update("reorderEnabled", v)}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
