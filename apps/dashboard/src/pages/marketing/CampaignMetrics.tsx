import React from "react";
import {
  CircleCheck,
  Coins,
  Receipt,
  Target,
  UsersRound,
  Wallet,
} from "lucide-react";
import type {
  MarketingCampaignReport,
  MarketingCampaignReview,
} from "../../api/marketing.js";
import { StatCard, StatCardGroup } from "../overview/components/StatCard.js";
import { DistributionChart } from "../../components/DistributionChart.js";
import { marketingMoney } from "./marketing-format.js";

export function CampaignAudienceMetrics({
  review,
}: {
  review: MarketingCampaignReview;
}) {
  return (
    <StatCardGroup columns={4}>
      <StatCard
        label="Contatos selecionados"
        value={review.selected}
        icon={<UsersRound size={16} />}
      />
      <StatCard
        label="Elegíveis agora"
        value={review.eligible}
        icon={<CircleCheck size={16} />}
      />
      <StatCard
        label="Reserva prevista"
        value={marketingMoney(review.estimatedReservationCents)}
        note="Estimativa interna de envio"
        icon={<Coins size={16} />}
      />
      <StatCard
        label="Orçamento"
        value={review.budgetSufficient ? "Suficiente" : "Insuficiente"}
        note="Para a reserva estimada"
        icon={<Wallet size={16} />}
      />
    </StatCardGroup>
  );
}

export function CampaignDeliveryMetrics({
  report,
  labels,
}: {
  report: Pick<
    MarketingCampaignReport,
    | "selected"
    | "eligible"
    | "counts"
    | "reservedCents"
    | "attributedRevenueCents"
  >;
  labels: Record<string, string>;
}) {
  return (
    <div className="marketing-campaign-metrics">
      <StatCardGroup columns={4}>
        <StatCard
          label="Selecionados na aprovação"
          value={report.selected}
          icon={<UsersRound size={16} />}
        />
        <StatCard
          label="Elegíveis na aprovação"
          value={report.eligible}
          icon={<Target size={16} />}
        />
        <StatCard
          label="Reserva estimada utilizada"
          value={marketingMoney(report.reservedCents)}
          note="Não representa a fatura da Meta"
          icon={<Coins size={16} />}
        />
        <StatCard
          label="Receita atribuída"
          value={
            report.attributedRevenueCents === null
              ? "Indisponível"
              : marketingMoney(report.attributedRevenueCents)
          }
          note="Somente compras com vínculo comprovado"
          icon={<Receipt size={16} />}
        />
      </StatCardGroup>
      <DistributionChart
        title="Situação dos envios"
        description="Distribuição atual dos destinatários aprovados. Aceite, entrega e leitura são situações diferentes."
        rows={Object.entries(labels).map(([key, label]) => ({
          key,
          label,
          value: report.counts[key] ?? 0,
        }))}
      />
    </div>
  );
}
