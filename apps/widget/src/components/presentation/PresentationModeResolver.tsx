import React, { useState } from "react";
import {
  resolvePresentationMode,
  resolveFabColor,
  resolveFabClickAction,
  resolveFabRedirectUrl,
  resolveInviteText,
  resolveShowCartBadge,
  type PresentationConfigInput
} from "./mode-resolver.js";
import { WidgetFAB } from "./WidgetFAB.js";
import { WidgetMiniCard } from "./WidgetMiniCard.js";
import { WidgetBanner } from "./WidgetBanner.js";
import { TriggerOnlyMode, type TriggerOnlyModeHandle } from "./TriggerOnlyMode.js";
import { InlineMode } from "./InlineMode.js";

export interface PresentationModeResolverProps {
  config: PresentationConfigInput;
  renderPanel: (api: { close: () => void }) => React.ReactNode;
  cartItemCount?: number;
  triggerOnlyRef?: React.Ref<TriggerOnlyModeHandle>;
  defaultDelayMs?: number;
}

export const PresentationModeResolver: React.FC<PresentationModeResolverProps> = ({
  config,
  renderPanel,
  cartItemCount = 0,
  triggerOnlyRef,
  defaultDelayMs = 0
}) => {
  const mode = resolvePresentationMode(config);
  const [panelOpen, setPanelOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const close = () => setPanelOpen(false);
  const open = () => setPanelOpen(true);

  if (mode === "trigger_only") {
    return (
      <TriggerOnlyMode ref={triggerOnlyRef} onTrigger={open}>
        {() => (panelOpen ? renderPanel({ close }) : null)}
      </TriggerOnlyMode>
    );
  }

  if (mode === "inline") {
    return <InlineMode>{renderPanel({ close })}</InlineMode>;
  }

  if (panelOpen) {
    return <>{renderPanel({ close })}</>;
  }

  if (dismissed && (mode === "mini_card" || mode === "bottom_banner")) {
    return null;
  }

  if (mode === "fab") {
    return (
      <WidgetFAB
        color={resolveFabColor(config)}
        position={config.position}
        onClick={open}
        badgeCount={cartItemCount}
        showCartBadge={resolveShowCartBadge(config)}
        delayMs={defaultDelayMs}
        clickAction={resolveFabClickAction(config)}
        redirectUrl={resolveFabRedirectUrl(config)}
      />
    );
  }

  if (mode === "mini_card") {
    return (
      <WidgetMiniCard
        inviteText={resolveInviteText(config)}
        position={config.position}
        onClick={open}
        onDismiss={() => setDismissed(true)}
        delayMs={defaultDelayMs}
      />
    );
  }

  if (mode === "bottom_banner") {
    return (
      <WidgetBanner
        inviteText={resolveInviteText(config)}
        ctaLabel="Falar com agente"
        onClick={open}
        onDismiss={() => setDismissed(true)}
        delayMs={defaultDelayMs}
      />
    );
  }

  return null;
};
