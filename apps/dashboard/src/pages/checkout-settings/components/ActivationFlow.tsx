import React from "react";
import { MousePointerClick, Timer, Zap, MessageSquare } from "lucide-react";
import type { Draft } from "../lib/draft.js";
import { ALL_TRIGGERS, TRIGGER_STATUS } from "../lib/constants.js";

export function ActivationFlow({ draft }: { draft: Draft }) {
  const activeTriggers = ALL_TRIGGERS.filter((t) => draft.triggers[t].enabled && TRIGGER_STATUS[t] === "active");

  const modeNode =
    draft.mode === "silent_until_trigger"
      ? { label: "Sinal do comprador", detail: `${activeTriggers.length} gatilhos ativos` }
      : draft.mode === "proactive"
      ? { label: "Tempo na página", detail: `após ${draft.initialDelaySeconds}s` }
      : { label: "Comprador abre", detail: "clica no chat" };

  const nodes = [
    {
      key: "signal",
      icon: <MousePointerClick size={15} strokeWidth={1.75} />,
      label: modeNode.label,
      detail: modeNode.detail,
    },
    {
      key: "guard",
      icon: <Timer size={15} strokeWidth={1.75} />,
      label: "Respeita limites",
      detail: `${draft.cooldownSeconds}s espera · máx ${draft.maxInterventionsPerSession}`,
      dim: draft.mode === "manual_only",
    },
    {
      key: "act",
      icon: <MessageSquare size={15} strokeWidth={1.75} />,
      label: "Agente age",
      detail: draft.openWidgetOnTrigger ? "abre o chat" : "avisa em silêncio",
      accent: true,
    },
  ];

  return (
    <div className="cfg-flow" role="img" aria-label="Passo a passo de quando o agente entra em ação">
      {nodes.map((n) => (
        <div key={n.key} className={`cfg-flow-node${n.accent ? " accent" : ""}${n.dim ? " dim" : ""}`}>
          <div className="cfg-flow-icon">{n.icon}</div>
          <div className="cfg-flow-text">
            <strong>{n.label}</strong>
            <span>{n.detail}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
