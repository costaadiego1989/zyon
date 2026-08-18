import type {
  AdvancedRule,
  CheckoutSettings,
  CheckoutSettingsContext,
  CheckoutSettingsPatch,
  CheckoutTriggerName,
  CheckoutTriggerRule,
  ProgressiveDiscountMode,
  ProgressiveDiscountStage,
  RuleAction,
  RuleCondition
} from "@zyon/shared-types";
import { CheckoutSettingsValidationError } from "../checkout-settings.errors.js";

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

const PROGRESSIVE_STAGES: ProgressiveDiscountStage[] = [
  "initial_coupon",
  "exit_intent",
  "abandoned_cart",
  "payment_nudge"
];

const DEFAULT_PROGRESSIVE_DISCOUNT = {
  enabled: false,
  stages: {
    initial_coupon: 5,
    exit_intent: 5,
    abandoned_cart: 10,
    payment_nudge: 15
  }
};

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
        initialDelaySeconds: 0,
        presentationMode: "fab",
        showCartBadge: true,
        inviteText: "Posso ajudar?",
        fabClickAction: "open_widget",
        fabRedirectUrl: "",
        cartPresentationMode: "floating"
      },
      interventionPolicy: {
        minimumAbandonmentScore: 0.7,
        cooldownSeconds: 120,
        maxInterventionsPerSession: 3,
        progressiveDiscount: DEFAULT_PROGRESSIVE_DISCOUNT
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
      advancedRules: [],
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
      interventionPolicy: mergeInterventionPolicy(this.props.interventionPolicy, patch.interventionPolicy),
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
      advancedRules: patch.advancedRules ?? this.props.advancedRules,
      updatedAt: now.toISOString()
    });
  }

  toContext(): CheckoutSettingsContext {
    return {
      merchant_id: this.props.merchantId,
      checkout_settings: {
        mode: this.props.mode,
        open_widget_on_trigger: this.props.widgetBehavior.openWidgetOnTrigger,
        position: this.props.widgetBehavior.position,
        fab_color: this.props.widgetBehavior.fabColor,
        invite_text: this.props.widgetBehavior.inviteText,
        presentation_mode: this.props.widgetBehavior.presentationMode,
        start_minimized: this.props.widgetBehavior.startMinimized,
        initial_delay_seconds: this.props.widgetBehavior.initialDelaySeconds,
        show_cart_badge: this.props.widgetBehavior.showCartBadge,
        fab_click_action: this.props.widgetBehavior.fabClickAction,
        fab_redirect_url: this.props.widgetBehavior.fabRedirectUrl,
        minimum_abandonment_score: this.props.interventionPolicy.minimumAbandonmentScore,
        cooldown_seconds: this.props.interventionPolicy.cooldownSeconds,
        max_interventions_per_session: this.props.interventionPolicy.maxInterventionsPerSession,
        enabled_triggers: this.props.triggerRules.filter((rule) => rule.enabled).map((rule) => rule.trigger),
        handoff_enabled: this.props.handoff.enabled,
        handoff_message: this.props.handoff.message,
        handoff_channels: this.props.handoff.channels,
        progressive_discount: this.props.interventionPolicy.progressiveDiscount,
        suppressed_steps: this.props.suppressionRules.suppressedSteps,
        blocked_regions: this.props.suppressionRules.blockedRegions
      },
      merchant_rules: this.props.advancedRules
        .filter(r => r.enabled)
        .sort((a, b) => a.priority - b.priority)
        .map(r => this.ruleToInstruction(r)),
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
      },
      advancedRules: this.props.advancedRules.map(r => ({ ...r, conditions: [...r.conditions], action: { ...r.action, params: { ...r.action.params } } }))
    };
  }

  private validate(): void {
    if (!this.props.merchantId) throw new CheckoutSettingsValidationError("merchant_id_required");
    if (this.props.interventionPolicy.cooldownSeconds < 30) throw new CheckoutSettingsValidationError("cooldown_too_low");
    if (this.props.interventionPolicy.maxInterventionsPerSession < 1) throw new CheckoutSettingsValidationError("max_interventions_too_low");
    if (this.props.interventionPolicy.maxInterventionsPerSession > 10) throw new CheckoutSettingsValidationError("max_interventions_too_high");
    if (
      this.props.interventionPolicy.minimumAbandonmentScore < 0 ||
      this.props.interventionPolicy.minimumAbandonmentScore > 1
    ) {
      throw new CheckoutSettingsValidationError("minimum_abandonment_score_out_of_range");
    }
    validateProgressiveDiscount(this.props.interventionPolicy.progressiveDiscount);
    validateTriggers(this.props.triggerRules);
    // CSS-H2: Validate handoff config
    if (!this.props.handoff.message || !this.props.handoff.message.trim()) {
      throw new CheckoutSettingsValidationError("handoff_message_required");
    }
    if (!this.props.handoff.channels || this.props.handoff.channels.length === 0) {
      throw new CheckoutSettingsValidationError("handoff_channels_required");
    }
    // CSS-H4: Validate blockedRegions format (ISO 3166 alpha-2)
    validateBlockedRegions(this.props.suppressionRules.blockedRegions);
    // Validate advanced rules
    validateAdvancedRules(this.props.advancedRules);
  }

  private ruleToInstruction(rule: AdvancedRule): string {
    const conditions = rule.conditions.map(c => CheckoutSettingsEntity.conditionToText(c)).join(" E ");
    const action = CheckoutSettingsEntity.actionToText(rule.action);
    return `SE ${conditions} ENTÃO ${action}`;
  }

  private static conditionToText(c: RuleCondition): string {
    const fieldLabels: Record<string, string> = {
      cart_total: "carrinho",
      shipping_cost: "frete",
      product_in_cart: "carrinho contém",
      category_in_cart: "categoria",
      coupon_applied: "cupom aplicado",
      buyer_type: "comprador",
      payment_method: "pagamento",
      trigger_fired: "trigger",
      cart_item_count: "itens no carrinho",
    };
    const opLabels: Record<string, string> = {
      gt: ">", lt: "<", gte: ">=", lte: "<=", eq: "=", contains: "contém", is: "é",
    };
    return `${fieldLabels[c.field] ?? c.field} ${opLabels[c.operator] ?? c.operator} ${c.value}`;
  }

  private static actionToText(a: RuleAction): string {
    switch (a.type) {
      case "offer_discount": return `ofereça ${a.params.percent}% de desconto`;
      case "offer_free_shipping": return "ofereça frete grátis";
      case "suggest_product": return `sugira o produto ${a.params.productName}`;
      case "show_message": return `diga: "${a.params.text}"`;
      case "offer_installments": return `ofereça ${a.params.maxInstallments}x sem juros`;
      case "do_nothing": return "não intervenha";
      case "offer_coupon": return `ofereça o cupom ${a.params.code}`;
      default: return "aja conforme melhor conveniência";
    }
  }
}

function validateTriggers(rules: CheckoutTriggerRule[]): void {
  const seen = new Set<string>();
  let hasEnabled = false;
  for (const rule of rules) {
    if (!ALLOWED_TRIGGERS.includes(rule.trigger)) throw new CheckoutSettingsValidationError("unknown_checkout_trigger");
    if (seen.has(rule.trigger)) throw new CheckoutSettingsValidationError("duplicate_checkout_trigger");
    if (rule.priority < 0 || rule.priority > 100) throw new CheckoutSettingsValidationError("trigger_priority_out_of_range");
    if (rule.enabled) hasEnabled = true;
    seen.add(rule.trigger);
  }
  // CSS-H1: At least one trigger must be enabled
  if (!hasEnabled) throw new CheckoutSettingsValidationError("at_least_one_trigger_must_be_enabled");
}

function mergeInterventionPolicy(
  current: CheckoutSettings["interventionPolicy"],
  patch: CheckoutSettingsPatch["interventionPolicy"]
): CheckoutSettings["interventionPolicy"] {
  const progressivePatch = patch?.progressiveDiscount;
  return {
    ...current,
    ...patch,
    progressiveDiscount: progressivePatch
      ? {
          enabled: progressivePatch.enabled ?? current.progressiveDiscount?.enabled ?? false,
          mode: progressivePatch.mode ?? current.progressiveDiscount?.mode,
          maxProgressivePercent: progressivePatch.maxProgressivePercent ?? current.progressiveDiscount?.maxProgressivePercent,
          stages: {
            ...DEFAULT_PROGRESSIVE_DISCOUNT.stages,
            ...current.progressiveDiscount?.stages,
            ...progressivePatch.stages
          }
        }
      : current.progressiveDiscount
  };
}

function validateProgressiveDiscount(policy: CheckoutSettings["interventionPolicy"]["progressiveDiscount"]): void {
  if (!policy) return;
  for (const stage of PROGRESSIVE_STAGES) {
    const value = policy.stages?.[stage];
    if (typeof value !== "number" || value < 0 || value > 100) {
      throw new CheckoutSettingsValidationError("progressive_discount_percent_out_of_range");
    }
  }
  if (policy.mode && !["progressive_only", "coupon_only", "both"].includes(policy.mode)) {
    throw new CheckoutSettingsValidationError("progressive_discount_mode_invalid");
  }
  if (policy.maxProgressivePercent !== undefined && (typeof policy.maxProgressivePercent !== "number" || policy.maxProgressivePercent < 0 || policy.maxProgressivePercent > 100)) {
    throw new CheckoutSettingsValidationError("progressive_discount_max_percent_out_of_range");
  }
}

function assertNoCommercialKeys(value: unknown, path: string[] = []): void {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = [...path, key];
    // Allow entire progressiveDiscount subtree
    if (nextPath.join(".") === "interventionPolicy.progressiveDiscount") {
      continue;
    }
    // Allow advancedRules subtree (contains actions that reference commercial concepts)
    if (nextPath.join(".") === "advancedRules") {
      continue;
    }
    if (COMMERCIAL_KEYS.some((commercialKey) => key.toLowerCase().includes(commercialKey.toLowerCase()))) {
      throw new CheckoutSettingsValidationError("checkout_settings_cannot_authorize_commercial_terms");
    }
    assertNoCommercialKeys(nested, nextPath);
  }
}

/**
 * CSS-H4: Validate region codes follow ISO 3166-1 alpha-2 format (2 uppercase letters).
 */
const ISO_3166_ALPHA2 = /^[A-Z]{2}$/;

function validateBlockedRegions(regions: string[]): void {
  for (const region of regions) {
    if (!ISO_3166_ALPHA2.test(region)) {
      throw new CheckoutSettingsValidationError("invalid_blocked_region_code");
    }
  }
}

function validateAdvancedRules(rules: AdvancedRule[]): void {
  if (rules.length > 20) {
    throw new CheckoutSettingsValidationError("advanced_rules_max_exceeded");
  }
  for (const rule of rules) {
    if (!rule.name || !rule.name.trim()) {
      throw new CheckoutSettingsValidationError("advanced_rule_name_required");
    }
    if (!rule.conditions || rule.conditions.length === 0) {
      throw new CheckoutSettingsValidationError("advanced_rule_conditions_required");
    }
    if (!rule.action) {
      throw new CheckoutSettingsValidationError("advanced_rule_action_required");
    }
  }
}
