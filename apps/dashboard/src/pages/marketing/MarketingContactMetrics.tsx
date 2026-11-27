import React from "react";
import {
  Clock,
  Coins,
  MessagesSquare,
  MessageSquareText,
  ShoppingBag,
} from "lucide-react";
import type { MarketingContactDetail } from "../../api/marketing.js";
import { StatCard, StatCardGroup } from "../overview/components/StatCard.js";
import { marketingMoney } from "./marketing-format.js";

export function MarketingContactMetrics({
  detail,
}: {
  detail: MarketingContactDetail;
}) {
  return (
    <StatCardGroup columns={5}>
      <StatCard
        label="Tempo nesta etapa"
        value={Math.floor(detail.timeInStageMs / 3600000)}
        suffix="horas"
        icon={<Clock size={16} />}
      />
      <StatCard
        label="Compras confirmadas"
        value={detail.contact.purchaseCount}
        icon={<ShoppingBag size={16} />}
      />
      <StatCard
        label="Valor comprado na loja"
        value={marketingMoney(detail.contact.totalSpentCents)}
        icon={<Coins size={16} />}
      />
      <StatCard
        label="Conversas conhecidas"
        value={detail.activity.conversationCount}
        icon={<MessagesSquare size={16} />}
      />
      <StatCard
        label="Mensagens conhecidas"
        value={detail.activity.messageCount}
        icon={<MessageSquareText size={16} />}
      />
    </StatCardGroup>
  );
}
