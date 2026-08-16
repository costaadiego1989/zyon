import React from "react";
import { MousePointerClick, Gauge, Timer, Zap } from "lucide-react";
import type { Draft } from "../lib/draft.js";
import { ALL_TRIGGERS } from "../lib/constants.js";

export function ActivationFlow({ draft }: { draft: Draft }) {
  const activeTriggers = ALL_TRIGGERS.filter((t) => draft.triggers[t].enabled);
  const scorePct = Math.round(draft.minimumAbandonmentScore * 100);

  const modeNode =
    draft.mode === "silent_until_trigger"
      ? { label: "Sinal do comprador", detail: `${activeTriggers.length} gatilhos ativos` }
      : draft.mode === "proactive"
      ? { label: "Tempo na página", detail: `após ${draft.initialDelaySeconds}s` }
      : { label: "Comprador abre", detail: "ação do usuário" };

  const nodes = [
    {
      key: "signal",
      icon: <MousePointerClick size={15} strokeWidth={1.75} />,
      label: modeNode.label,
      detail: modeNode.detail,
    },
    {
      key: "score",
      icon: <Gauge size={15} strokeWidth={1.75} />,
      label: "Risco de perda",
      detail: draft.mode === "manual_only" ? "não avaliado" : `≥ ${scorePct}%`,
      dim: draft.mode === "manual_only",
    },
    {
      key: "guard",
      icon: <Timer size={15} strokeWidth={1.75} />,
      label: "Respeita limites",
      detail: `${draft.cooldownSeconds}s espera · máx ${draft.maxInterventionsPerSession}`,
    },
    {
      key: "act",
      icon: <Zap size={15} strokeWidth={1.75} />,
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
