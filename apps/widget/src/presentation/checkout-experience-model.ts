import type { CSSProperties } from "react";
import type { CheckoutAgentViewModel } from "../hooks/use-checkout-agent-view-model.js";
import {
  agentGivenAndRest,
  formatCurrency,
  resolveStepperProgressPct,
  STAGE_FLOW,
  themeStyle,
} from "../hooks/checkout-presentation.js";

export type ExperienceAccountModel =
  | {
      kind: "authenticated";
      label: "Minha conta";
      initial: string;
      onOpen: () => void;
    }
  | {
      kind: "recognized";
      label: string;
      initial: string;
      onOpen: () => void;
    }
  | {
      kind: "anonymous";
      label: "Entrar";
      onOpen: () => void;
    };

export type ExperienceHeaderModel = {
  agent: {
    name: string;
    role: string;
    avatarUrl?: string;
    statusLabel: string;
  };
  assurance: {
    title: string;
    description: string;
  };
  account: ExperienceAccountModel;
  colorMode: "light" | "dark";
  order: {
    isOpen: boolean;
    total: string;
    onOpen: () => void;
  };
  support: {
    isOpen: boolean;
    onToggle: () => void;
  };
  onToggleColorMode: () => void;
};

export type JourneyProtocolModel = {
  currentLabel: string;
  currentNumber: string;
  progressPercent: number;
  valueText: string;
  steps: Array<{
    key: string;
    label: string;
    status: "done" | "active" | "pending";
  }>;
};

export type CheckoutExperiencePresentation = {
  colorMode: "light" | "dark";
  stage: string;
  style: CSSProperties;
  header: ExperienceHeaderModel;
  journey: JourneyProtocolModel;
};

export function selectJourneyProtocol(activeStage: string): JourneyProtocolModel {
  const resolvedIndex = STAGE_FLOW.findIndex((step) => step.key === activeStage);
  const activeIndex = resolvedIndex >= 0 ? resolvedIndex : 0;
  const current = STAGE_FLOW[activeIndex] ?? STAGE_FLOW[0];

  return {
    currentLabel: current.label,
    currentNumber: String(activeIndex + 1).padStart(2, "0"),
    progressPercent: resolveStepperProgressPct(activeIndex, STAGE_FLOW.length),
    valueText: `${current.label}, etapa ${activeIndex + 1} de ${STAGE_FLOW.length}`,
    steps: STAGE_FLOW.map((step, index) => ({
      key: step.key,
      label: step.shortLabel,
      status: index < activeIndex ? "done" : index === activeIndex ? "active" : "pending",
    })),
  };
}

export function selectExperienceHeader(
  vm: CheckoutAgentViewModel,
): ExperienceHeaderModel {
  const configuredAgentName = vm.theme.agentName || vm.activeExperience.agent.name;
  const agentName = agentGivenAndRest(configuredAgentName);
  const customerName = vm.activeExperience.customer?.fullName?.trim();

  let account: ExperienceAccountModel;
  if (vm.auth.session) {
    account = {
      kind: "authenticated",
      label: "Minha conta",
      initial: (vm.auth.session.email?.[0] ?? customerName?.[0] ?? "C").toUpperCase(),
      onOpen: vm.openBuyerPanel,
    };
  } else if (vm.activeExperience.customer?.email_verified) {
    const givenName = customerName?.split(/\s+/)[0] || "Cliente";
    account = {
      kind: "recognized",
      label: `Olá, ${givenName}`,
      initial: givenName[0]?.toUpperCase() ?? "C",
      onOpen: vm.openBuyerPanel,
    };
  } else {
    account = {
      kind: "anonymous",
      label: "Entrar",
      onOpen: vm.auth.openLogin,
    };
  }

  return {
    agent: {
      name: vm.theme.headerTitle?.trim() || agentName.given || configuredAgentName,
      role: "Agente de compras",
      avatarUrl: vm.theme.agentAvatarUrl,
      statusLabel:
        vm.theme.headerSubtitle?.trim() ||
        `${vm.activeExperience.brand.name} | online`,
    },
    assurance: {
      title: "Compra protegida",
      description: "Voce revisa tudo antes de pagar",
    },
    account,
    colorMode: vm.colorMode,
    order: {
      isOpen: vm.cartOpen,
      total: formatCurrency(vm.visibleTotals.total, vm.visibleTotals.currency),
      onOpen: () => vm.setCartOpen(true),
    },
    support: {
      isOpen: vm.supportOpen,
      onToggle: () => vm.setSupportOpen(!vm.supportOpen),
    },
    onToggleColorMode: vm.toggleColorMode,
  };
}

export function selectCheckoutExperiencePresentation(
  vm: CheckoutAgentViewModel,
): CheckoutExperiencePresentation {
  return {
    colorMode: vm.colorMode,
    stage: vm.checkoutStage,
    style: themeStyle(vm.theme, true, vm.colorMode, "pulse"),
    header: selectExperienceHeader(vm),
    journey: selectJourneyProtocol(vm.checkoutStage),
  };
}
