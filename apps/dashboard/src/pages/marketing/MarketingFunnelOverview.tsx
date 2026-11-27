import React from "react";
import { CircleCheck, CircleX, Target, UsersRound } from "lucide-react";
import { StatCard, StatCardGroup } from "../overview/components/StatCard.js";
import { FunnelDiagram } from "../../components/FunnelDiagram.js";
import { DistributionChart } from "../../components/DistributionChart.js";
import {
  marketingStages,
  marketingStageLabels,
  type MarketingFunnel,
  type MarketingStage,
} from "../../api/marketing.js";
import { originLabel } from "./marketing-format.js";

export function MarketingFunnelOverview({
  funnel,
  selectedStage,
  selectedOrigin,
  onStageSelect,
  onOriginSelect,
}: {
  funnel: MarketingFunnel | null;
  selectedStage: string;
  selectedOrigin: string;
  onStageSelect: (stage: MarketingStage) => void;
  onOriginSelect: (channel: string) => void;
}) {
  const count = (stage: MarketingStage) =>
    funnel
      ? funnel.rows
          .filter((row) => row.stage === stage)
          .reduce((sum, row) => sum + row.total, 0)
      : null;
  const stages = marketingStages.map((stage) => ({
    key: stage,
    label: marketingStageLabels[stage],
    value: count(stage),
    share: funnel
      ? funnel.total
        ? ((count(stage) ?? 0) / funnel.total) * 100
        : 0
      : null,
    description: funnel
      ? funnel.rows
          .filter((row) => row.stage === stage)
          .map(
            (row) =>
              `${originLabel(row.origin)}: ${row.total.toLocaleString("pt-BR")}`
          )
          .join(" · ") || "Nenhum contato"
      : undefined,
  }));
  const active = funnel
    ? funnel.rows
        .filter((row) =>
          ["interested", "shopping", "payment_pending"].includes(row.stage)
        )
        .reduce((sum, row) => sum + row.total, 0)
    : null;
  const show = (value: number | null) => value ?? "—";
  return (
    <section
      className="marketing-section marketing-funnel"
      aria-label="Funil de contatos identificados"
    >
      <StatCardGroup columns={4}>
        <StatCard
          label="Contatos identificados"
          value={show(funnel?.total ?? null)}
          icon={<UsersRound size={16} />}
          note="Base atual da loja"
        />
        <StatCard
          label="Oportunidades ativas"
          value={show(active)}
          icon={<Target size={16} />}
          note="Interesse, compra ou pagamento pendente"
        />
        <StatCard
          label="Compra confirmada"
          value={show(count("purchased"))}
          icon={<CircleCheck size={16} />}
          note="Contatos nesta etapa"
        />
        <StatCard
          label="Sem conversão"
          value={show(count("lost"))}
          icon={<CircleX size={16} />}
          note="Contatos fora do fluxo ativo"
        />
      </StatCardGroup>
      <div className="marketing-analytics">
        <section>
          <header className="marketing-section-heading">
            <div>
              <h2>Funil de relacionamento</h2>
              <p>
                Etapa atual de cada contato. Selecione uma etapa para filtrar a
                lista.
              </p>
            </div>
            <span className="marketing-total">
              {funnel?.total.toLocaleString("pt-BR") ?? "—"}{" "}
              {funnel?.total === 1
                ? "contato identificado"
                : "contatos identificados"}
            </span>
          </header>
          <FunnelDiagram
            stages={stages.filter((stage) => stage.key !== "lost")}
            outcomes={stages.filter((stage) => stage.key === "lost")}
            label="Etapas atuais dos contatos"
            selectedKey={selectedStage}
            onSelect={(key) => onStageSelect(key as MarketingStage)}
          />
          <p className="marketing-help marketing-funnel-note">
            Os percentuais mostram a participação na base atual. Eles não medem
            a taxa de conversão entre etapas.
          </p>
        </section>
        <section className="marketing-analytics__origins">
          <DistributionChart
            title="Origem dos contatos"
            description="Distribuição da base identificada. Selecione uma origem para filtrar a lista."
            rows={(["whatsapp", "site", "unknown"] as const).map((origin) => ({
              key: origin,
              label: originLabel(origin),
              value: funnel
                ? funnel.rows
                    .filter((row) => row.origin === origin)
                    .reduce((sum, row) => sum + row.total, 0)
                : null,
            }))}
            selectedKey={selectedOrigin}
            onSelect={(key) => onOriginSelect(key)}
          />
          <div className="marketing-identification-note">
            <h3>Como os contatos entram na base</h3>
            <p>
              No WhatsApp, o primeiro contato já identifica o número. No site, a
              identificação acontece após cadastro ou login. Visitantes anônimos
              não entram neste funil.
            </p>
          </div>
        </section>
      </div>
    </section>
  );
}
