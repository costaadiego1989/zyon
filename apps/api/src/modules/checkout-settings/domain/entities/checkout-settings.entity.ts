import type {
  CheckoutSettings,
  CheckoutSettingsContext,
  CheckoutSettingsPatch,
  CheckoutTriggerName,
  CheckoutTriggerRule
} from "@zyon/shared-types";

const ALLOWED_TRIGGERS: CheckoutTriggerName[] = [
  "shipping_objection_detected",
  "coupon_field_clicked",
  "payment_failed",
  "exit_intent_detected",
  "idle_30_seconds"
];

const COMMERCIAL_KEYS = [
  "discount",
  "freeShipping",
  "margin",
  "offer",
  "shippingSubsidy",
  "deliveryPromise",
  "stockPromise",
  "paymentStatus"
];

export class CheckoutSettingsEntity {
  private constructor(private readonly props: CheckoutSettings) {
    this.validate();
  }

  static createDefault(input: { merchantId: string; now?: Date }): CheckoutSettingsEntity {
    const now = (input.now ?? new Date()).toISOString();
    return new CheckoutSettingsEntity({
      merchantId: input.merchantId,
      mode: "silent_until_trigger",
      widgetBehavior: {
        openWidgetOnTrigger: true,
        startMinimized: true,
        position: "bottom_right",
        initialDelaySeconds: 0
      },
      interventionPolicy: {
        minimumAbandonmentScore: 0.7,
        cooldownSeconds: 120,
        maxInterventionsPerSession: 3
      },
      triggerRules: [
        { trigger: "shipping_objection_detected", enabled: true, priority: 100 },
        { trigger: "coupon_field_clicked", enabled: true, priority: 80 },
        { trigger: "idle_30_seconds", enabled: true, priority: 60 },
        { trigger: "payment_failed", enabled: true, priority: 90 },
        { trigger: "exit_intent_detected", enabled: true, priority: 70 }
      ],
      suppressionRules: {
        suppressedSteps: [],
        blockedRegions: [],
        minimumCartValue: 0,
        suppressAfterOfferAccepted: true,
        respectBuyerOptOut: true
      },
      handoff: {
        enabled: true,
        message: "I can call a store specialist if you prefer.",
        channels: ["chat", "email"]
      },
      createdAt: now,
      updatedAt: now
    });
  }

  static rehydrate(settings: CheckoutSettings): CheckoutSettingsEntity {
    return new CheckoutSettingsEntity(settings);
  }

  update(patch: CheckoutSettingsPatch, now = new Date()): CheckoutSettingsEntity {
    assertNoCommercialKeys(patch);
    return new CheckoutSettingsEntity({
      ...this.props,
      mode: patch.mode ?? this.props.mode,
      widgetBehavior: { ...this.props.widgetBehavior, ...patch.widgetBehavior },
      interventionPolicy: { ...this.props.interventionPolicy, ...patch.interventionPolicy },
      triggerRules: patch.triggerRules ? [...patch.triggerRules] : this.props.triggerRules,
      suppressionRules: {
        ...this.props.suppressionRules,
        ...patch.suppressionRules,
        suppressedSteps: patch.suppressionRules?.suppressedSteps ?? this.props.suppressionRules.suppressedSteps,
        blockedRegions: patch.suppressionRules?.blockedRegions ?? this.props.suppressionRules.blockedRegions
      },
      handoff: {
        ...this.props.handoff,
        ...patch.handoff,
        channels: patch.handoff?.channels ?? this.props.handoff.channels
      },
      updatedAt: now.toISOString()
    });
  }

  toContext(): CheckoutSettingsContext {
    return {
      merchant_id: this.props.merchantId,
      checkout_settings: {
        mode: this.props.mode,
        open_widget_on_trigger: this.props.widgetBehavior.openWidgetOnTrigger,
        minimum_abandonment_score: this.props.interventionPolicy.minimumAbandonmentScore,
        cooldown_seconds: this.props.interventionPolicy.cooldownSeconds,
        max_interventions_per_session: this.props.interventionPolicy.maxInterventionsPerSession,
        enabled_triggers: this.props.triggerRules.filter((rule) => rule.enabled).map((rule) => rule.trigger),
        handoff_enabled: this.props.handoff.enabled
      },
      operational_constraints: [
        "Do not open the widget more than the configured max interventions per session.",
        "Respect the configured cooldown before another intervention.",
        "Do not mention offers unless authorized by deterministic modules."
      ]
    };
  }

  snapshot(): CheckoutSettings {
    return {
      ...this.props,
      widgetBehavior: { ...this.props.widgetBehavior },
      interventionPolicy: { ...this.props.interventionPolicy },
      triggerRules: this.props.triggerRules.map((rule) => ({ ...rule })),
      suppressionRules: {
        ...this.props.suppressionRules,
        suppressedSteps: [...this.props.suppressionRules.suppressedSteps],
        blockedRegions: [...this.props.suppressionRules.blockedRegions]
      },
      handoff: {
        ...this.props.handoff,
        channels: [...this.props.handoff.channels]
      }
    };
  }

  private validate(): void {
    if (!this.props.merchantId) throw new Error("merchant_id_required");
    if (this.props.interventionPolicy.cooldownSeconds < 30) throw new Error("cooldown_too_low");
    if (this.props.interventionPolicy.maxInterventionsPerSession < 1) throw new Error("max_interventions_too_low");
    if (this.props.interventionPolicy.maxInterventionsPerSession > 10) throw new Error("max_interventions_too_high");
    if (
      this.props.interventionPolicy.minimumAbandonmentScore < 0 ||
      this.props.interventionPolicy.minimumAbandonmentScore > 1
    ) {
      throw new Error("minimum_abandonment_score_out_of_range");
    }
    validateTriggers(this.props.triggerRules);
  }
}

function validateTriggers(rules: CheckoutTriggerRule[]): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (!ALLOWED_TRIGGERS.includes(rule.trigger)) throw new Error("unknown_checkout_trigger");
    if (seen.has(rule.trigger)) throw new Error("duplicate_checkout_trigger");
    if (rule.priority < 0 || rule.priority > 100) throw new Error("trigger_priority_out_of_range");
    seen.add(rule.trigger);
  }
}

function assertNoCommercialKeys(value: unknown): void {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (COMMERCIAL_KEYS.some((commercialKey) => key.toLowerCase().includes(commercialKey.toLowerCase()))) {
      throw new Error("checkout_settings_cannot_authorize_commercial_terms");
    }
    assertNoCommercialKeys(nested);
  }
}
