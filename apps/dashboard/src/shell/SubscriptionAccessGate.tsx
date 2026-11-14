import React from "react";
import { LockKeyhole } from "lucide-react";
import { Button } from "../components/Button.js";
import { EmptyState } from "../components/EmptyState.js";
import type { Role } from "../lib/auth/roles.js";
import type { TabKey } from "./nav-config.js";
import { isSubscriptionRouteAllowed } from "./subscription-route-policy.js";

type Props = {
  required: boolean;
  role: Role | undefined;
  tab: TabKey;
  onViewPlans: () => void;
  onRefresh?: () => Promise<void>;
  children: React.ReactNode;
};

/** Keep the selected navigation visible, but never mount a restricted module. */
export function SubscriptionAccessGate({ required, role, tab, onViewPlans, onRefresh, children }: Props) {
  if (isSubscriptionRouteAllowed(tab, required, role)) return <>{children}</>;
  return <div role="status" aria-label="Acesso ao módulo bloqueado">
    <EmptyState icon={LockKeyhole} title="Assinatura necessária"
      description={role === "OWNER"
        ? "Seu período gratuito terminou. Escolha um plano para voltar a usar este módulo. Seus dados continuam salvos."
        : "Este módulo está bloqueado pela assinatura. Peça ao proprietário para regularizar o plano da loja."}
      action={<>
        {role === "OWNER" && <Button onClick={onViewPlans}>Ver planos</Button>}
        {onRefresh && <Button variant="outline" onClick={() => void onRefresh()}>Atualizar assinatura</Button>}
      </>} />
  </div>;
}
