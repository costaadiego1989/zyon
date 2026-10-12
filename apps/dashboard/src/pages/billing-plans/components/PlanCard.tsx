import type { BillingCycle, BillingOffer } from "@zyon/shared-types";
import { selectedBillingOffer } from "../plan-catalog.js";
import React from "react";
import { BillingPlanDetails } from "./BillingPlanDetails.js";
import { Button } from "../../../components/Button.js";

export interface PlanDef {
  key: "starter" | "growth" | "scale";
  name: string;
  price: number;
  billingOptions?: BillingOffer[];
  annualCheckoutAvailable?: boolean;
  fee: string;
  limits: { orders: number | undefined; voiceSessions: number | undefined };
  features: string[];
  recommended?: boolean;
  trialDays?: number;
}

interface PlanCardProps {
  plan: PlanDef;
  isCurrent: boolean;
  isDowngrade: boolean;
  onUpgrade: () => void;
  upgrading: boolean;
  actionLabel?: string;
  insufficientCapacity?: boolean;
  billingCycle?: BillingCycle;
}

export function PlanCard({
  plan,
  isCurrent,
  isDowngrade,
  onUpgrade,
  upgrading,
  actionLabel,
  insufficientCapacity = false,
  billingCycle = "monthly",
}: PlanCardProps) {
  const offer = selectedBillingOffer(plan, billingCycle);
  const borderColor = isCurrent
    ? "var(--color-brand)"
    : plan.recommended
      ? "var(--color-brand-ring)"
      : "var(--color-border)";

  const cardBg = plan.recommended
    ? "color-mix(in oklab, var(--color-brand-subtle) 50%, var(--surface-2))"
    : "var(--surface-2)";

  return (
    <article
      data-plan-key={plan.key}
      style={{
        flex: 1,
        minWidth: 0,
        padding: "24px",
        borderRadius: 14,
        border: `1px solid ${borderColor}`,
        background: cardBg,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        position: "relative",
        boxShadow: plan.recommended
          ? "0 4px 24px oklch(74% 0.19 149 / 0.08)"
          : undefined,
      }}
    >
      {/* Recommended badge */}
      {plan.recommended && !isCurrent && (
        <div
          style={{
            position: "absolute",
            top: -1,
            left: 20,
            right: 20,
            height: 2,
            background: "var(--color-brand)",
            borderRadius: "0 0 2px 2px",
          }}
        />
      )}

      <BillingPlanDetails plan={plan} billingCycle={billingCycle} />

      {/* CTA */}
      <Button
        variant={isCurrent ? "outline" : isDowngrade ? "outline" : "primary"}
        arrow={!isCurrent && !upgrading}
        fullWidth
        onClick={onUpgrade}
        disabled={isCurrent || upgrading || insufficientCapacity || !offer}
      >
        {insufficientCapacity ? "Capacidade insuficiente neste mês" : actionLabel ?? (isCurrent
          ? "Seu plano"
          : isDowngrade
            ? "Downgrade"
            : "Fazer upgrade")}
      </Button>
    </article>
  );
}
