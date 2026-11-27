import React, { useId } from "react";
import "./distribution-chart.css";

export interface DistributionChartRow {
  key: string;
  label: string;
  value: number | null;
}
export function DistributionChart({
  title,
  description,
  rows,
  selectedKey,
  onSelect,
}: {
  title: string;
  description?: string;
  rows: DistributionChartRow[];
  selectedKey?: string;
  onSelect?: (key: string) => void;
}) {
  const titleId = useId();
  const total = rows.some((row) => row.value === null)
    ? null
    : rows.reduce((sum, row) => sum + (row.value ?? 0), 0);
  const Row = onSelect ? "button" : "div";
  return (
    <figure className="distribution-chart" aria-labelledby={titleId}>
      <figcaption>
        <h3 id={titleId}>{title}</h3>
        {description && <p>{description}</p>}
      </figcaption>
      <ul>
        {rows.map((row) => {
          const share =
            total === null
              ? null
              : total > 0
              ? ((row.value ?? 0) / total) * 100
              : 0;
          return (
            <li key={row.key}>
              <Row
                className="distribution-chart__row"
                {...(onSelect
                  ? {
                      type: "button" as const,
                      "aria-pressed": selectedKey === row.key,
                      onClick: () => onSelect(row.key),
                    }
                  : {})}
              >
                <span className="distribution-chart__label">{row.label}</span>
                <span className="distribution-chart__amount">
                  <strong>
                    {row.value === null
                      ? "—"
                      : row.value.toLocaleString("pt-BR")}
                  </strong>
                  <span>
                    {share === null
                      ? "—"
                      : `${share.toLocaleString("pt-BR", {
                          maximumFractionDigits: 1,
                        })}%`}
                  </span>
                </span>
                <span className="distribution-chart__track" aria-hidden="true">
                  <span style={{ width: `${share ?? 0}%` }} />
                </span>
              </Row>
            </li>
          );
        })}
      </ul>
      {total === 0 && (
        <p className="distribution-chart__empty">Nenhum registro nesta base.</p>
      )}
    </figure>
  );
}
