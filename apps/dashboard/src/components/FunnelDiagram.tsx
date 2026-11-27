import React from "react";
import { CornerDownRight } from "lucide-react";
import "./funnel-diagram.css";

export interface FunnelDiagramStage {
  key: string;
  label: string;
  value: number | null;
  share?: number | null;
  description?: string;
  detail?: string;
}

export interface FunnelDiagramProps {
  stages: FunnelDiagramStage[];
  outcomes?: FunnelDiagramStage[];
  label: string;
  selectedKey?: string;
  onSelect?: (key: string) => void;
  scale?: "sequence" | "value";
  supportingLabel?: string;
}

const number = (value: number | null) =>
  value === null ? "—" : value.toLocaleString("pt-BR");
const compact = (value: number | null) =>
  value === null
    ? "—"
    : new Intl.NumberFormat("pt-BR", {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(value);

/** Sequence scale illustrates a CRM's current stages without inventing conversion.
 * Value scale sizes journey stages by their authoritative counts; branch events
 * remain outside the main cascade. Full counts stay readable beside narrow shapes.
 */
export function FunnelDiagram({
  stages,
  outcomes = [],
  label,
  selectedKey,
  onSelect,
  scale = "sequence",
  supportingLabel = "Outros desfechos",
}: FunnelDiagramProps) {
  const Row = onSelect ? "button" : "div";
  const peak = Math.max(0, ...stages.map((stage) => stage.value ?? 0));
  const render = (
    stage: FunnelDiagramStage,
    index: number,
    outcome = false
  ) => {
    const width = (value: number | null) =>
      peak > 0 ? ((value ?? 0) / peak) * 98 : 0;
    const top =
      scale === "value"
        ? width(stage.value)
        : 98 - (index / Math.max(stages.length, 1)) * 60;
    const bottom =
      scale === "value"
        ? width(stages[index + 1]?.value ?? stage.value)
        : 98 - ((index + 1) / Math.max(stages.length, 1)) * 60;
    const edge = (width: number) => (400 - width * 4) / 2;
    return (
      <li
        key={stage.key}
        className={outcome ? "funnel-diagram__outcome" : undefined}
      >
        <Row
          className="funnel-diagram__stage"
          data-funnel-stage={stage.key}
          {...(onSelect
            ? {
                type: "button" as const,
                "aria-pressed": selectedKey === stage.key,
                onClick: () => onSelect(stage.key),
              }
            : {})}
        >
          <span
            className="funnel-diagram__shape"
            aria-hidden="true"
            data-empty={stage.value === 0 || stage.value === null}
          >
            {outcome ? (
              <CornerDownRight size={24} />
            ) : (
              <>
                <svg viewBox="0 0 400 76" preserveAspectRatio="none">
                  <polygon
                    points={`${edge(top)},2 ${400 - edge(top)},2 ${
                      400 - edge(bottom)
                    },74 ${edge(bottom)},74`}
                    style={{
                      fill:
                        stage.value === 0 || stage.value === null
                          ? "var(--surface-2)"
                          : `color-mix(in oklab, var(--color-brand) ${
                              18 + (index / Math.max(stages.length - 1, 1)) * 22
                            }%, var(--surface-2))`,
                    }}
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <span
                  className="funnel-diagram__value"
                  hidden={scale === "value" && top < 24}
                >
                  {compact(stage.value)}
                </span>
              </>
            )}
          </span>
          <span className="funnel-diagram__reading">
            <span className="funnel-diagram__label">{stage.label}</span>
            <span className="funnel-diagram__amount">
              <strong>{number(stage.value)}</strong>
              {stage.share !== undefined && stage.share !== null && (
                <span>
                  {stage.share.toLocaleString("pt-BR", {
                    maximumFractionDigits: 1,
                  })}
                  %
                </span>
              )}
            </span>
            {stage.description && (
              <span className="funnel-diagram__description">
                {stage.description}
              </span>
            )}
            {stage.detail && (
              <span className="funnel-diagram__detail">{stage.detail}</span>
            )}
          </span>
        </Row>
      </li>
    );
  };
  return (
    <div className="funnel-diagram" role="group" aria-label={label}>
      <ol className="funnel-diagram__stages">
        {stages.map((stage, index) => render(stage, index))}
      </ol>
      {outcomes.length > 0 && (
        <section className="funnel-diagram__supporting">
          <h4>{supportingLabel}</h4>
          <ul className="funnel-diagram__outcomes" aria-label={supportingLabel}>
            {outcomes.map((stage, index) => render(stage, index, true))}
          </ul>
        </section>
      )}
    </div>
  );
}
