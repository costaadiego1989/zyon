import type { BillingCycle, BillingOffer, AutomaticBillingPromotion } from "@zyon/shared-types";
import { selectedBillingOffer } from "../plan-catalog.js";
import React from "react";
import { PlanTile } from "./PlanTile.js";
import { Button } from "../../../components/Button.js";

export interface PlanDef {
  key: "starter" | "starter179" | "growth" | "scale";
  name: string;
  price: number;
  billingOptions?: BillingOffer[];
  annualCheckoutAvailable?: boolean;
  fee: string;
  limits: { orders: number | undefined; voiceSessions: number | undefined };
  features: string[];
  recommended?: boolean;
  trialDays?: number;
  promotion?: AutomaticBillingPromotion;
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
  return (
    <PlanTile plan={plan} billingCycle={billingCycle} selected={isCurrent}>

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
    </PlanTile>
  );
}
