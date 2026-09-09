import { BadRequestException, ConflictException, Inject, Injectable, Logger, Optional, ServiceUnavailableException } from "@nestjs/common";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppChannelConfigEntity, type WhatsAppConfigRepository } from "../../domain/ports/whatsapp-config-repository.port.js";
import { WHATSAPP_ONBOARDING_STORE, TwilioOnboardingError, type OnboardingLease, type WhatsAppOnboardingStore } from "../../domain/ports/whatsapp-onboarding.port.js";
import { TEMPLATE_PACKAGE_SUBMITTER, type TemplatePackageSubmitter } from "../../domain/ports/template-package-submitter.port.js";
import { WHATSAPP_SIGNUP_AUTHORIZATION, type MetaCloudAuthorizedAssets, type WhatsAppSignupAuthorization } from "../../domain/ports/whatsapp-signup-authorization.port.js";

export interface ConnectViaEmbeddedSignupInput {
  merchantId: string;
  code: string;
  wabaId: string;
  phoneNumberId: string;
}

/** Official Meta Cloud API onboarding for an individual merchant WABA. */
@Injectable()
export class ConfigureWhatsAppUseCase {
  private readonly logger = new Logger(ConfigureWhatsAppUseCase.name);

  constructor(
    @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configRepo: WhatsAppConfigRepository,
    @Inject(WHATSAPP_ONBOARDING_STORE) private readonly store: WhatsAppOnboardingStore,
    @Inject(WHATSAPP_SIGNUP_AUTHORIZATION) private readonly authorization: WhatsAppSignupAuthorization,
    @Optional() @Inject(TEMPLATE_PACKAGE_SUBMITTER) private readonly templatePackage?: TemplatePackageSubmitter,
  ) {}

  settings() {
    const appId = process.env.META_EMBEDDED_SIGNUP_APP_ID ?? process.env.META_APP_ID ?? "";
    const configId = process.env.META_EMBEDDED_SIGNUP_CONFIGURATION_ID ?? "";
    return { configured: Boolean(appId && configId && process.env.META_APP_SECRET && process.env.META_WEBHOOK_VERIFY_TOKEN), appId, configId };
  }

  async connection(merchantId: string) { return this.view(await this.configRepo.findByMerchantId(merchantId)); }

  private view(config: WhatsAppChannelConfigEntity | null) {
    return {
      provider: config?.provider ?? "META_CLOUD",
      status: config?.status.toLowerCase() ?? "disconnected",
      enabled: config?.enabled ?? false,
      whatsappNumber: config?.whatsappNumber ?? null,
      connectedAt: config?.connectedAt ?? null,
      onboardingError: config?.credentials.onboardingError ?? null,
    };
  }

  private async exclusive(merchantId: string, fn: (lease: OnboardingLease) => Promise<void>) {
    const lease = await this.store.claim(merchantId);
    if (!lease) throw new ConflictException("whatsapp_onboarding_in_progress");
    try {
      await fn(lease);
      return this.view(lease.config);
    } catch (error) {
      if (!(error instanceof TwilioOnboardingError)) throw error;
      await this.store.save(lease, {
        enabled: false,
        status: error.code === "META_SUBSCRIPTION_UNKNOWN" ? "PROVISIONING" : "ERROR",
        credentials: { ...lease.config.credentials, onboardingError: error.code },
      });
      this.logger.warn(`Meta Cloud onboarding: ${error.code}`);
      return { ...this.view(lease.config), error: error.code };
    } finally {
      await this.store.release(lease);
    }
  }

  async connectViaEmbeddedSignup(input: ConnectViaEmbeddedSignupInput) {
    if (!input.code?.trim() || !/^\d{5,40}$/.test(input.wabaId) || !/^\d{5,40}$/.test(input.phoneNumberId)) {
      throw new BadRequestException("whatsapp_invalid_signup");
    }
    if (!this.settings().configured) return { status: "PLATFORM_NOT_CONFIGURED" };

    return this.exclusive(input.merchantId, async lease => {
      const previous = lease.config;
      const credentials = previous.credentials;
      if (previous.enabled && previous.provider !== "META_CLOUD") {
        throw new TwilioOnboardingError("WHATSAPP_CONNECTION_REVIEW_REQUIRED");
      }
      if (credentials.wabaId && credentials.wabaId !== input.wabaId) {
        throw new ConflictException("whatsapp_identity_change_requires_support");
      }

      const authorized = await this.authorization.authorize(input);
      if (previous.whatsappNumber && previous.whatsappNumber !== authorized.whatsappNumber.slice(1)) {
        throw new ConflictException("whatsapp_identity_change_requires_support");
      }
      await this.persistAuthorizedConnection(lease, authorized);
      await this.subscribe(lease);
    });
  }

  private async persistAuthorizedConnection(lease: OnboardingLease, authorized: MetaCloudAuthorizedAssets) {
    await this.store.save(lease, {
      provider: "META_CLOUD",
      whatsappNumber: authorized.whatsappNumber.slice(1),
      status: "PROVISIONING",
      enabled: false,
      credentials: {
        ...lease.config.credentials,
        onboardingVersion: 3,
        wabaId: authorized.wabaId,
        phoneNumberId: authorized.phoneNumberId,
        accessToken: authorized.accessToken,
        ...(authorized.tokenExpiresAt ? { tokenExpiresAt: authorized.tokenExpiresAt.toISOString() } : {}),
        subscriptionStatus: "PENDING",
        desiredEnabled: true,
        onboardingError: null,
      },
    });
  }

  private assets(config: WhatsAppChannelConfigEntity): MetaCloudAuthorizedAssets {
    const credentials = config.credentials;
    const accessToken = typeof credentials.accessToken === "string" ? credentials.accessToken : "";
    const wabaId = typeof credentials.wabaId === "string" ? credentials.wabaId : "";
    const phoneNumberId = typeof credentials.phoneNumberId === "string" ? credentials.phoneNumberId : "";
    const number = config.whatsappNumber;
    if (!accessToken || !/^\d{5,40}$/.test(wabaId) || !/^\d{5,40}$/.test(phoneNumberId) || !number) {
      throw new TwilioOnboardingError("META_CREDENTIALS_UNAVAILABLE");
    }
    return { accessToken, wabaId, phoneNumberId, whatsappNumber: `+${number}` };
  }

  private async subscribe(lease: OnboardingLease) {
    await this.authorization.subscribe(this.assets(lease.config));
    const activateTemplates = lease.config.status !== "ACTIVE";
    await this.store.save(lease, {
      status: "ACTIVE",
      enabled: lease.config.credentials.desiredEnabled !== false,
      ...(lease.config.connectedAt ? {} : { connectedAt: new Date() }),
      credentials: { ...lease.config.credentials, subscriptionStatus: "SUBSCRIBED", onboardingError: null },
    });
    if (activateTemplates && this.templatePackage) {
      void this.templatePackage.execute(lease.config.merchantId).catch(() => this.logger.warn("Meta template package submission failed"));
    }
  }

  async refresh(merchantId: string) {
    return this.exclusive(merchantId, async lease => {
      if (lease.config.status === "DISCONNECTED") return;
      if (lease.config.provider !== "META_CLOUD" || lease.config.credentials.onboardingVersion !== 3) {
        throw new TwilioOnboardingError("WHATSAPP_CONNECTION_REVIEW_REQUIRED");
      }
      if (!await this.authorization.isSubscribed(this.assets(lease.config))) {
        throw new TwilioOnboardingError("META_SUBSCRIPTION_NOT_CONFIRMED");
      }
      const activateTemplates = lease.config.status !== "ACTIVE";
      await this.store.save(lease, {
        status: "ACTIVE",
        enabled: lease.config.credentials.desiredEnabled !== false,
        ...(lease.config.connectedAt ? {} : { connectedAt: new Date() }),
        credentials: { ...lease.config.credentials, subscriptionStatus: "SUBSCRIBED", onboardingError: null },
      });
      if (activateTemplates && this.templatePackage) {
        void this.templatePackage.execute(lease.config.merchantId).catch(() => this.logger.warn("Meta template package submission failed"));
      }
    });
  }

  async disconnect(merchantId: string) {
    return this.exclusive(merchantId, async lease => {
      const { accessToken: _token, tokenExpiresAt: _expiresAt, desiredEnabled: _enabled, ...rest } = lease.config.credentials;
      await this.store.save(lease, {
        enabled: false,
        status: "DISCONNECTED",
        credentials: { ...rest, subscriptionStatus: "DISCONNECTED", onboardingError: null },
      });
    });
  }

  async setEnabled(merchantId: string, enabled: boolean) {
    return this.exclusive(merchantId, async lease => {
      if (enabled && lease.config.status !== "ACTIVE") throw new ConflictException("whatsapp_not_active");
      if (lease.config.provider === "BUBBLEWHATS") {
        if (enabled && !lease.config.webhookSecret?.trim()) throw new ServiceUnavailableException("whatsapp_webhook_secret_required");
        await this.store.save(lease, { enabled });
        return;
      }
      if (lease.config.provider !== "META_CLOUD") throw new TwilioOnboardingError("WHATSAPP_CONNECTION_REVIEW_REQUIRED");
      await this.store.save(lease, { enabled, credentials: { ...lease.config.credentials, desiredEnabled: enabled } });
    });
  }
}
