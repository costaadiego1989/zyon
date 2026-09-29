import { SetupGuide } from "../../components/SetupGuide.js";
import { PageHeader } from "../../components/PageHeader.js";
import React, { useId, useState } from "react";
import { Star, ThumbsUp, ThumbsDown, MessageCircle, CheckCircle2, Settings } from "lucide-react";
import type { MerchantProfile } from "../../api-client.js";
import { StatCard } from "../overview/components/StatCard.js";
import { TabBar } from "../../components/TabBar.js";
import { DataPanel } from "../../components/DataPanel.js";
import { SectionHeader } from "../../components/SectionHeader.js";
import { Button } from "../../components/Button.js";
import { EmptyState } from "../../components/EmptyState.js";
import { ToggleSwitch } from "../../components/ToggleSwitch.js";
import { usePostSalePage } from "./usePostSalePage.js";
import { usePostSaleConfig } from "./usePostSaleConfig.js";
import { TemplateEditor } from "./TemplateEditor.js";
import "./post-sale.css";

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
      <PageHeader title="Pós-venda" description="Login necessário" />
    );
  }

  return (
    <div className="page-container post-sale-page">
      {/* Header */}
      <PageHeader title="Pós-venda" description="Configure mensagens após a compra e acompanhe as avaliações e a satisfação dos seus compradores." />
      <SetupGuide title="Como configurar mensagens após a compra" steps={[{"title":"Escolha o cenário","description":"Defina a finalidade da mensagem, como acompanhar a compra ou solicitar uma avaliação."},{"title":"Configure momento e canal","description":"Revise o intervalo e o canal. O envio depende da conexão, das permissões do cliente e das aprovações indicadas."},{"title":"Revise o texto e salve","description":"Confira a mensagem e salve o rascunho. Acompanhe os estados das tentativas; mensagem enviada não comprova entrega ao cliente."}]} />

      {/* Stats Row */}
      {!vm.loading && !vm.error && <div className="grid-4" style={{ gap: 14 }}>
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
      </div>}

      {/* Tabs */}
      <TabBar
        tabs={[
          { key: "overview", label: "Visão geral" },
          { key: "reviews", label: `Avaliações (${vm.reviewsTotal})` },
          { key: "nps", label: `Satisfação (${vm.npsTotal})` },
          { key: "config", label: "Configurações" },
        ]}
        activeTab={tab}
        onTabChange={(k) => setTab(k as "overview" | "reviews" | "nps" | "config")}
      />

      {tab !== "config" && vm.error && <EmptyState title="Resultados indisponíveis" description={vm.error} action={<Button variant="outline" onClick={vm.retry}>Tentar novamente</Button>} />}
      {/* Overview Tab */}
      {tab === "overview" && !vm.error && (
        <div className="panel" style={{ padding: "20px 24px" }}>
          <SectionHeader title="Resumo das mensagens" variant="secondary" />
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
                  Enviadas / programadas
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
      {tab === "reviews" && !vm.error && (
        <DataPanel
          title="Avaliações" page={vm.reviewsPage} pageSize={20} total={vm.reviewsTotal} onPageChange={page => { if (!vm.loading) vm.setReviewsPage(page); }}
          isEmpty={!vm.loading && vm.reviews.length === 0}
          empty={{ icon: Star, title: "Nenhuma avaliação recebida", description: "As avaliações dos compradores aparecerão aqui conforme forem enviadas." }}
        >
          {vm.moderationError && <p className="post-sale-template-editor__feedback post-sale-template-editor__feedback--error" role="alert">{vm.moderationError}</p>}
          {vm.loading && <p role="status" className="post-sale-results-loading">Carregando avaliações…</p>}
          {!vm.loading && vm.reviews.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "500 12px var(--font-sans)", color: "var(--color-text-faint)", borderBottom: "1px solid var(--color-border)" }}>
                      Avaliação
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "500 12px var(--font-sans)", color: "var(--color-text-faint)", borderBottom: "1px solid var(--color-border)" }}>
                      Texto
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "500 12px var(--font-sans)", color: "var(--color-text-faint)", borderBottom: "1px solid var(--color-border)" }}>
                      Status
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "500 12px var(--font-sans)", color: "var(--color-text-faint)", borderBottom: "1px solid var(--color-border)" }}>
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {vm.reviews.map((review, i) => (
                    <tr key={review.id} style={{ borderBottom: i < vm.reviews.length - 1 ? "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)" : undefined }}>
                      <td style={{ padding: "12px 20px", font: "500 13px var(--font-sans)" }}>
                        <span role="img" aria-label={`${review.rating} de 5 estrelas`} style={{ display: "flex", gap: 4, alignItems: "center" }}>
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
                          font: "500 12px var(--font-sans)",
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
                              disabled={!!vm.moderatingId} loading={vm.moderatingId === review.id}
                              onClick={() => vm.handleModerateReview(review.id, "approved")}
                            >
                              Aprovar
                            </Button>
                            <Button
                              size="sm"
                              disabled={!!vm.moderatingId}
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
      {tab === "nps" && !vm.error && (
        <DataPanel
          title="Respostas de satisfação" page={vm.npsPage} pageSize={20} total={vm.npsTotal} onPageChange={page => { if (!vm.loading) vm.setNpsPage(page); }}
          isEmpty={!vm.loading && vm.npsItems.length === 0}
          empty={{ icon: ThumbsUp, title: "Nenhuma resposta de satisfação", description: "As notas de 0 a 10 e os comentários aparecerão aqui conforme os compradores responderem à pesquisa." }}
        >
          {vm.loading && <p role="status" className="post-sale-results-loading">Carregando respostas…</p>}
          {!vm.loading && vm.npsItems.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "500 12px var(--font-sans)", color: "var(--color-text-faint)", borderBottom: "1px solid var(--color-border)" }}>
                      Nota
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "500 12px var(--font-sans)", color: "var(--color-text-faint)", borderBottom: "1px solid var(--color-border)" }}>
                      Classificação
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "500 12px var(--font-sans)", color: "var(--color-text-faint)", borderBottom: "1px solid var(--color-border)" }}>
                      Comentário
                    </th>
                    <th style={{ textAlign: "left", padding: "10px 20px", font: "500 12px var(--font-sans)", color: "var(--color-text-faint)", borderBottom: "1px solid var(--color-border)" }}>
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
                          font: "500 12px var(--font-sans)",
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
        <div className="post-sale-workspace">
          <CampaignSettings cfg={cfg} />
          <TemplateEditor me={props.me} />
        </div>
      )}
    </div>
  );
}

function CampaignSettings({ cfg }: { cfg: ReturnType<typeof usePostSaleConfig> }) {
  const id = useId();
  const campaigns = [
    { title: "Acompanhamento da entrega", description: "Contato após a confirmação de entrega do pedido.", enabled: cfg.config.followUpEnabled, update: (value: boolean) => cfg.update("followUpEnabled", value) },
    { title: "Pedido de avaliação", description: `${cfg.config.reviewDelayDays} dias após a confirmação de entrega.`, enabled: cfg.config.reviewEnabled, update: (value: boolean) => cfg.update("reviewEnabled", value) },
    { title: "Pesquisa de satisfação (NPS)", description: `Peça uma nota de 0 a 10, ${cfg.config.npsDelayDays} dias após a confirmação de entrega.`, enabled: cfg.config.npsEnabled, update: (value: boolean) => cfg.update("npsEnabled", value) },
    { title: "Produtos complementares", description: `${cfg.config.crossSellDelayDays} dias após a confirmação de entrega.`, enabled: cfg.config.crossSellEnabled, update: (value: boolean) => cfg.update("crossSellEnabled", value) },
    { title: "Retorno de clientes", description: `Procura clientes sem compras há ${cfg.config.winBackThresholdDays} dias para um convite com cupom.`, enabled: cfg.config.winBackEnabled, update: (value: boolean) => cfg.update("winBackEnabled", value) },
    { title: "Cupom de fidelidade", description: `Reconheça a fidelidade nas compras de número ${cfg.config.loyaltyMilestones.split(",").join(", ")}.`, enabled: cfg.config.loyaltyEnabled, update: (value: boolean) => cfg.update("loyaltyEnabled", value) },
    { title: "Lembrete de recompra", description: "Lembrete para produtos que precisam de reposição.", enabled: cfg.config.reorderEnabled, update: (value: boolean) => cfg.update("reorderEnabled", value) },
  ];

  return (
    <section className="panel post-sale-campaigns" aria-busy={cfg.loading || cfg.saving}>
      <SectionHeader
        title="Campanhas de pós-venda"
        subtitle="Defina quais contatos entram na jornada depois da compra. Cada alteração é salva ao acionar o botão da campanha."
      />
      {cfg.saveError && <p role="alert" className="post-sale-template-editor__feedback post-sale-template-editor__feedback--error">{cfg.saveError}</p>}
      {cfg.loading ? (
        <div className="post-sale-campaigns__loading" role="status">
          <span />
          <span />
          <span />
          Carregando campanhas…
        </div>
      ) : cfg.loadError ? <EmptyState title="Campanhas indisponíveis" description={cfg.loadError} action={<Button variant="outline" onClick={cfg.reload}>Tentar novamente</Button>} /> : (
        <div className="post-sale-campaigns__list">
          {campaigns.map((campaign, index) => (
            <article className="post-sale-campaign" data-enabled={campaign.enabled} key={campaign.title}>
              <div className="post-sale-campaign__content">
                <h3><label htmlFor={`${id}-${index}`}>{campaign.title}</label></h3>
                <p>{campaign.description}</p>
              </div>
              <div className="post-sale-campaign__control">
                <span>{campaign.enabled ? "Ativa" : "Pausada"}</span>
                <ToggleSwitch id={`${id}-${index}`} checked={campaign.enabled} disabled={cfg.saving} onChange={campaign.update} />
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
