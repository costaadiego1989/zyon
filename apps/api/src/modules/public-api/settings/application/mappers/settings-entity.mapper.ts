/**
 * Settings Entity Mapper
 *
 * Converts domain entities to API response DTOs.
 * All response fields use snake_case per API convention.
 */
export class SettingsEntityMapper {
  /**
   * Map checkout settings entity to API response DTO.
   * Normalizes field names to snake_case.
   */
  static toCheckoutSettingsResponse(settings: any): any {
    return {
      merchant_id: settings.merchantId,
      mode: settings.mode,
      widget_behavior: {
        position: settings.widgetBehavior.position,
        fab_color: settings.widgetBehavior.fabColor,
        invite_text: settings.widgetBehavior.inviteText,
        presentation_mode: settings.widgetBehavior.presentationMode,
        start_minimized: settings.widgetBehavior.startMinimized,
        initial_delay_seconds: settings.widgetBehavior.initialDelaySeconds,
        show_cart_badge: settings.widgetBehavior.showCartBadge,
        fab_click_action: settings.widgetBehavior.fabClickAction,
        fab_redirect_url: settings.widgetBehavior.fabRedirectUrl,
        cart_presentation_mode: settings.widgetBehavior.cartPresentationMode,
        budget_mode_enabled: settings.widgetBehavior.budgetModeEnabled,
        open_widget_on_trigger: settings.widgetBehavior.openWidgetOnTrigger,
      },
      trigger_rules: settings.triggerRules.map((rule: any) => ({
        trigger: rule.trigger,
        enabled: rule.enabled,
        weight: rule.weight,
        condition: rule.condition,
      })),
      suppression_rules: {
        suppressed_steps: settings.suppressionRules.suppressedSteps,
        blocked_regions: settings.suppressionRules.blockedRegions,
        minimum_cart_value: settings.suppressionRules.minimumCartValue,
      },
      handoff: {
        enabled: settings.handoff.enabled,
        message: settings.handoff.message,
        channels: settings.handoff.channels,
      },
      intervention_policy: {
        cooldown_seconds: settings.interventionPolicy.cooldownSeconds,
        max_interventions_per_session: settings.interventionPolicy.maxInterventionsPerSession,
      },
      updated_at: settings.updatedAt,
      created_at: settings.createdAt,
    };
  }

  /**
   * Map agent rules entity to API response DTO.
   * Normalizes field names to snake_case.
   */
  static toAgentRulesResponse(rules: any): any {
    return {
      merchant_id: rules.merchantId,
      agent_id: rules.agentId,
      user_id: rules.userId,
      guardrails: {
        forbid_unauthorized_discounts: rules.guardrails.forbidUnauthorizedDiscounts,
        forbid_unauthorized_free_shipping: rules.guardrails.forbidUnauthorizedFreeShipping,
        forbid_payment_method_changes: rules.guardrails.forbidPaymentMethodChanges,
      },
      discount_policy: {
        max_discount_percent: rules.discountPolicy.maxDiscountPercent,
        minimum_margin_percent: rules.discountPolicy.minimumMarginPercent,
      },
      shipping_policy: {
        max_subsidy_percent: rules.shippingPolicy.maxSubsidyPercent,
        max_subsidy_absolute: rules.shippingPolicy.maxSubsidyAbsolute,
      },
      copy_constraints: rules.copyConstraints || [],
      created_at: rules.createdAt,
      updated_at: rules.updatedAt,
    };
  }
}
