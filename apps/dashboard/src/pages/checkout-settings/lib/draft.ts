import type {
  CheckoutSettings,
  CheckoutSettingsMode,
  CheckoutSettingsPatch,
  CheckoutTriggerName,
  CheckoutWidgetPosition,
} from "@zyon/shared-types";
import { ALL_TRIGGERS } from "./constants.js";

export interface Draft {
  mode: CheckoutSettingsMode;
  openWidgetOnTrigger: boolean;
  startMinimized: boolean;
  position: CheckoutWidgetPosition;
  initialDelaySeconds: number;
  minimumAbandonmentScore: number;
  cooldownSeconds: number;
  maxInterventionsPerSession: number;
  triggers: Record<CheckoutTriggerName, { enabled: boolean; priority: number }>;
  suppressAfterOfferAccepted: boolean;
  respectBuyerOptOut: boolean;
  minimumCartValue: number;
  suppressedSteps: string[];
  blockedRegions: string[];
  handoffEnabled: boolean;
  handoffMessage: string;
  handoffChannels: Array<"email" | "whatsapp" | "chat">;
}

export const DEFAULT_DRAFT: Draft = {
  mode: "silent_until_trigger",
  openWidgetOnTrigger: true,
  startMinimized: true,
  position: "bottom_right",
  initialDelaySeconds: 4,
  minimumAbandonmentScore: 0.6,
  cooldownSeconds: 90,
  maxInterventionsPerSession: 3,
  triggers: {
    shipping_objection_detected: { enabled: true, priority: 70 },
    coupon_field_clicked: { enabled: true, priority: 60 },
    payment_failed: { enabled: true, priority: 90 },
    exit_intent_detected: { enabled: true, priority: 50 },
    idle_30_seconds: { enabled: false, priority: 30 },
  },
  suppressAfterOfferAccepted: true,
  respectBuyerOptOut: true,
  minimumCartValue: 0,
  suppressedSteps: [],
  blockedRegions: [],
  handoffEnabled: false,
  handoffMessage:
    "Vou transferir você para um atendente humano. Um momento, por favor.",
  handoffChannels: ["chat"],
};

export function settingsToDraft(s: CheckoutSettings): Draft {
  const triggers = Object.fromEntries(
    ALL_TRIGGERS.map((t) => {
      const rule = s.triggerRules.find((r) => r.trigger === t);
      return [t, { enabled: rule?.enabled ?? false, priority: rule?.priority ?? 50 }];
    })
  ) as Draft["triggers"];

  return {
    mode: s.mode,
    openWidgetOnTrigger: s.widgetBehavior.openWidgetOnTrigger,
    startMinimized: s.widgetBehavior.startMinimized,
    position: s.widgetBehavior.position,
    initialDelaySeconds: s.widgetBehavior.initialDelaySeconds,
    minimumAbandonmentScore: s.interventionPolicy.minimumAbandonmentScore,
    cooldownSeconds: s.interventionPolicy.cooldownSeconds,
    maxInterventionsPerSession: s.interventionPolicy.maxInterventionsPerSession,
    triggers,
    suppressAfterOfferAccepted: s.suppressionRules.suppressAfterOfferAccepted,
    respectBuyerOptOut: s.suppressionRules.respectBuyerOptOut,
    minimumCartValue: s.suppressionRules.minimumCartValue ?? 0,
    suppressedSteps: s.suppressionRules.suppressedSteps,
    blockedRegions: s.suppressionRules.blockedRegions,
    handoffEnabled: s.handoff.enabled,
    handoffMessage: s.handoff.message,
    handoffChannels: s.handoff.channels,
  };
}

export function draftToPatch(d: Draft): CheckoutSettingsPatch {
  return {
    mode: d.mode,
    widgetBehavior: {
      openWidgetOnTrigger: d.openWidgetOnTrigger,
      startMinimized: d.startMinimized,
      position: d.position,
      initialDelaySeconds: d.initialDelaySeconds,
    },
    interventionPolicy: {
      minimumAbandonmentScore: d.minimumAbandonmentScore,
      cooldownSeconds: d.cooldownSeconds,
      maxInterventionsPerSession: d.maxInterventionsPerSession,
    },
    triggerRules: ALL_TRIGGERS.map((t) => ({
      trigger: t,
      enabled: d.triggers[t].enabled,
      priority: d.triggers[t].priority,
    })),
    suppressionRules: {
      suppressAfterOfferAccepted: d.suppressAfterOfferAccepted,
      respectBuyerOptOut: d.respectBuyerOptOut,
      minimumCartValue: d.minimumCartValue > 0 ? d.minimumCartValue : undefined,
      suppressedSteps: d.suppressedSteps,
      blockedRegions: d.blockedRegions,
    },
    handoff: {
      enabled: d.handoffEnabled,
      message: d.handoffMessage,
      channels: d.handoffChannels,
    },
  };
}

export function draftsEqual(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
