import type {
  CheckoutSettings,
  CheckoutSettingsMode,
  CheckoutSettingsPatch,
  CheckoutTriggerName,
  CheckoutWidgetPosition,
} from "@zyon/shared-types";
import { ALL_TRIGGERS, TRIGGER_FIXED_PRIORITIES } from "./constants.js";

export interface AdvancedRule {
  id: string;
  name: string;
  conditions: Array<{ field: string; operator: string; value: string | number | boolean }>;
  action: { type: string; params: Record<string, string | number> };
  enabled: boolean;
  priority: number;
}

export interface Draft {
  mode: CheckoutSettingsMode;
  openWidgetOnTrigger: boolean;
  startMinimized: boolean;
  position: CheckoutWidgetPosition;
  initialDelaySeconds: number;
  minimumAbandonmentScore: number;
  cooldownSeconds: number;
  maxInterventionsPerSession: number;
  triggers: Record<CheckoutTriggerName, { enabled: boolean; message?: string; cooldownSeconds?: number; couponCode?: string }>;
  suppressAfterOfferAccepted: boolean;
  respectBuyerOptOut: boolean;
  minimumCartValue: number;
  progressiveDiscountEnabled: boolean;
  progressiveMaxPercent: number;
  progressiveInitialCouponPercent: number;
  progressiveExitIntentPercent: number;
  progressiveAbandonedCartPercent: number;
  progressivePaymentNudgePercent: number;
  fabColor: string;
  inviteText: string;
  showCartBadge: boolean;
  checkoutReturnUrl: string;
  advancedRules: AdvancedRule[];
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
    shipping_objection_detected: { enabled: true },
    coupon_field_clicked: { enabled: true },
    payment_failed: { enabled: true },
    exit_intent_detected: { enabled: true },
    idle_30_seconds: { enabled: false },
  },
  suppressAfterOfferAccepted: true,
  respectBuyerOptOut: true,
  minimumCartValue: 0,
  progressiveDiscountEnabled: false,
  progressiveMaxPercent: 20,
  progressiveInitialCouponPercent: 7,
  progressiveExitIntentPercent: 10,
  progressiveAbandonedCartPercent: 15,
  progressivePaymentNudgePercent: 7,
  fabColor: "#3b82f6",
  inviteText: "Posso ajudar?",
  showCartBadge: true,
  checkoutReturnUrl: "",
  advancedRules: [],
};


export function settingsToDraft(s: CheckoutSettings): Draft {
  const triggers = Object.fromEntries(
    ALL_TRIGGERS.map((t) => {
      const rule = s.triggerRules.find((r) => r.trigger === t);
      return [t, { enabled: rule?.enabled ?? false, message: rule?.message, cooldownSeconds: rule?.cooldownSeconds, couponCode: rule?.couponCode }];
    })
  ) as Draft["triggers"];

  const stages = s.interventionPolicy.progressiveDiscount?.stages ?? {
    initial_coupon: 5,
    exit_intent: 7,
    abandoned_cart: 10,
    payment_nudge: 5,
  };

  return {
    mode: s.mode,
    openWidgetOnTrigger: s.widgetBehavior.openWidgetOnTrigger,
    startMinimized: s.widgetBehavior.startMinimized,
    position: s.widgetBehavior.position,
    initialDelaySeconds: s.widgetBehavior.initialDelaySeconds ?? DEFAULT_DRAFT.initialDelaySeconds,
    minimumAbandonmentScore: s.interventionPolicy.minimumAbandonmentScore ?? DEFAULT_DRAFT.minimumAbandonmentScore,
    cooldownSeconds: s.interventionPolicy.cooldownSeconds ?? DEFAULT_DRAFT.cooldownSeconds,
    maxInterventionsPerSession: s.interventionPolicy.maxInterventionsPerSession ?? DEFAULT_DRAFT.maxInterventionsPerSession,
    triggers,
    suppressAfterOfferAccepted: s.suppressionRules.suppressAfterOfferAccepted,
    respectBuyerOptOut: s.suppressionRules.respectBuyerOptOut,
    minimumCartValue: s.suppressionRules.minimumCartValue ?? 0,
    progressiveDiscountEnabled: s.interventionPolicy.progressiveDiscount?.enabled ?? false,
    progressiveMaxPercent: s.interventionPolicy.progressiveDiscount?.maxProgressivePercent ?? 20,
    progressiveInitialCouponPercent: stages.initial_coupon,
    progressiveExitIntentPercent: stages.exit_intent,
    progressiveAbandonedCartPercent: stages.abandoned_cart,
    progressivePaymentNudgePercent: stages.payment_nudge,
    fabColor: s.widgetBehavior.fabColor ?? "#3b82f6",
    inviteText: s.widgetBehavior.inviteText ?? "Posso ajudar?",
    showCartBadge: s.widgetBehavior.showCartBadge !== false,
    checkoutReturnUrl: (s.widgetBehavior as any).checkoutReturnUrl ?? "",
    advancedRules: (s as any).advancedRules ?? [],
  };
}

export function draftToPatch(d: Draft): CheckoutSettingsPatch {
  const stages = {
    initial_coupon: d.progressiveInitialCouponPercent,
    exit_intent: d.progressiveExitIntentPercent,
    abandoned_cart: d.progressiveAbandonedCartPercent,
    payment_nudge: d.progressivePaymentNudgePercent,
  };
  return {
    mode: d.mode,
    interventionPolicy: {
      minimumAbandonmentScore: d.minimumAbandonmentScore,
      cooldownSeconds: d.cooldownSeconds,
      maxInterventionsPerSession: d.maxInterventionsPerSession,
      progressiveDiscount: {
        enabled: d.progressiveDiscountEnabled,
        maxProgressivePercent: d.progressiveMaxPercent,
        stages,
      },
    },
    triggerRules: ALL_TRIGGERS.map((t) => ({
      trigger: t,
      enabled: d.triggers[t].enabled,
      priority: TRIGGER_FIXED_PRIORITIES[t],
      message: d.triggers[t].message || undefined,
      cooldownSeconds: d.triggers[t].cooldownSeconds || undefined,
      couponCode: d.triggers[t].couponCode || undefined,
    })),
    suppressionRules: {
      suppressAfterOfferAccepted: d.suppressAfterOfferAccepted,
      respectBuyerOptOut: d.respectBuyerOptOut,
      minimumCartValue: d.minimumCartValue > 0 ? d.minimumCartValue : undefined,
    },
    widgetBehavior: {
      openWidgetOnTrigger: d.openWidgetOnTrigger,
      startMinimized: d.startMinimized,
      position: d.position,
      initialDelaySeconds: d.initialDelaySeconds,
      fabColor: d.fabColor,
      inviteText: d.inviteText,
      showCartBadge: d.showCartBadge,
      fabClickAction: "open_widget",
      fabRedirectUrl: "",
    },
    advancedRules: d.advancedRules,
  } as CheckoutSettingsPatch;
}

export function draftsEqual(a: Draft, b: Draft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
