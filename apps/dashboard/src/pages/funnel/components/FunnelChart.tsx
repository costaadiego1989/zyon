import React from "react";
import { SectionHeader } from "../../../components/SectionHeader.js";
import { FunnelDiagram } from "../../../components/FunnelDiagram.js";
import type { FunnelStep, FunnelTransition } from "../useFunnelPage.js";

export function FunnelChart({
  steps,
  transitions,
}: {
  steps: FunnelStep[];
  transitions: FunnelTransition[];
}): React.ReactElement {
  const conversionStep =
    steps.find((step) => step.name === "order_completed") ??
    steps.find((step) => step.name === "auth_registration_completed");
  const stages = steps.map((step) => {
    const transition = transitions.find((item) => item.from === step.name);
    const next = steps.find((item) => item.name === transition?.to);
    // Optional and non-monotonic events cannot prove abandonment.
    const showDrop =
      transition &&
      step.count > 0 &&
      next &&
      next.count < step.count &&
      transition.dropOff > 0;
    return {
      key: step.name,
      label: step.label,
      value: step.count,
      share: step.percentage,
      detail: showDrop
        ? `${transition.dropOff.toFixed(
            0
          )}% saiu antes de ${next.label.toLocaleLowerCase("pt-BR")}`
        : undefined,
    };
  });
  const complementary = new Set([
    "coupon_applied",
    "payment_failed",
    "login_completed",
  ]);
  return (
    <section className="fnl-chart-card">
      <SectionHeader
        variant="secondary"
        title="Etapas da jornada"
        trailing={
          <span className="fnl-chart-conversion">
            {steps.length
              ? `${(conversionStep?.percentage ?? 0).toFixed(1)}% conversão`
              : "—"}
          </span>
        }
      />
      <FunnelDiagram
        label="Funil da jornada"
        scale="value"
        stages={stages.filter((stage) => !complementary.has(stage.key))}
        outcomes={stages.filter((stage) => complementary.has(stage.key))}
        supportingLabel="Eventos complementares"
      />
    </section>
  );
}
