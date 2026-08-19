import React from "react";
import type { MarketplaceConfig } from "../types.js";

interface SettlementTimelineProps {
  config: MarketplaceConfig;
}

export function SettlementTimeline({ config }: SettlementTimelineProps) {
  const returnDay = config.return_window_days;
  const settlementDay = returnDay + config.settlement_window_days;
  const chargebackDay = config.chargeback_window_days;

  const events = [
    { day: 0, description: "Compra capturada" },
    { day: returnDay, description: `Sem devolução → transferência agendada` },
    { day: settlementDay, description: `Seller recebe repasse (${returnDay} + ${config.settlement_window_days})` },
    { day: chargebackDay, description: "Settlement finalizado" },
  ];

  return (
    <div className="settlement-timeline">
      <h4 className="settlement-timeline__title">Resumo do fluxo</h4>
      <div className="settlement-timeline__events">
        {events.map((event) => (
          <div key={event.day} className="timeline-event">
            <div className="timeline-event__marker" />
            <div className="timeline-event__content">
              <span className="timeline-event__day">Dia {event.day}</span>
              <span className="timeline-event__description">{event.description}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
