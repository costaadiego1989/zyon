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
   * Map store settings entity to API response DTO.
   * Normalizes field names to snake_case.
   */
  static toStoreSettingsResponse(settings: any, updatedAt?: Date | null): any {
    return {
      company: settings.company
        ? {
            cnpj: settings.company.cnpj ?? null,
            razao_social: settings.company.razaoSocial ?? null,
            inscricao_estadual: settings.company.inscricaoEstadual ?? null,
            email: settings.company.email ?? null,
            phone: settings.company.phone ?? null,
            address: settings.company.address
              ? {
                  street: settings.company.address.street ?? null,
                  number: settings.company.address.number ?? null,
                  complement: settings.company.address.complement ?? null,
                  neighborhood: settings.company.address.neighborhood ?? null,
                  city: settings.company.address.city ?? null,
                  state: settings.company.address.state ?? null,
                  zip: settings.company.address.zip ?? null,
                }
              : null,
          }
        : null,
      social: settings.social
        ? {
            instagram: settings.social.instagram ?? null,
            facebook: settings.social.facebook ?? null,
            linkedin: settings.social.linkedin ?? null,
            youtube: settings.social.youtube ?? null,
            google_maps: settings.social.googleMaps ?? null,
          }
        : null,
      policies: settings.policies
        ? {
            privacy: settings.policies.privacy ?? null,
            returns: settings.policies.returns ?? null,
            terms: settings.policies.terms ?? null,
            shipping: settings.policies.shipping ?? null,
          }
        : null,
      styles: settings.styles
        ? {
            logo_url: settings.styles.logoUrl ?? null,
            favicon_url: settings.styles.faviconUrl ?? null,
            accent_color: settings.styles.accentColor ?? null,
            secondary_color: settings.styles.secondaryColor ?? null,
            font_display: settings.styles.fontDisplay ?? null,
            font_family: settings.styles.fontFamily ?? null,
          }
        : null,
      business_hours: settings.businessHours ?? [],
      slug: settings.slug ?? null,
      updated_at: updatedAt ?? null,
    };
  }

  /**
   * Map SEO/GTM settings entity to API response DTO.
   * Normalizes field names to snake_case.
   */
  static toSeoSettingsResponse(config: any): any {
    const seo = config.seo ?? {};
    const gtm = config.gtm ?? {};
    return {
      seo: {
        title: seo.title ?? null,
        description: seo.description ?? null,
        og_title: seo.ogTitle ?? null,
        og_description: seo.ogDescription ?? null,
        og_image: seo.ogImage ?? null,
        keywords: seo.keywords ?? [],
        twitter_card: seo.twitterCard ?? null,
        robots: seo.robots ?? null,
        canonical: seo.canonical ?? null,
      },
      gtm: {
        gtm_id: gtm.gtmId ?? null,
        ga_tracking_id: gtm.gaTrackingId ?? null,
        pixel_ids: gtm.pixelIds
          ? {
              facebook: gtm.pixelIds.facebook ?? null,
              tiktok: gtm.pixelIds.tiktok ?? null,
              snapchat: gtm.pixelIds.snapchat ?? null,
              pinterest: gtm.pixelIds.pinterest ?? null,
            }
          : null,
      },
      updated_at: config.lastUpdatedAt ?? config.updatedAt ?? null,
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
