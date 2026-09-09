import { Injectable } from "@nestjs/common";
import { TwilioOnboardingError } from "../../domain/ports/whatsapp-onboarding.port.js";
import type { MetaCloudAuthorizedAssets, WhatsAppSignupAuthorization } from "../../domain/ports/whatsapp-signup-authorization.port.js";
import { whatsappE164 } from "../../domain/services/whatsapp-phone.js";

/**
 * Exchanges the short-lived Embedded Signup code on the server, verifies the
 * selected WABA/phone against the granted assets, and subscribes the Zyon app
 * to that WABA. The resulting Business Integration System User token is kept
 * server-side only and encrypted by the repository.
 */
@Injectable()
export class MetaSignupAuthorizationAdapter implements WhatsAppSignupAuthorization {
  private readonly graph = "https://graph.facebook.com/v23.0";

  private appId(): string {
    return process.env.META_EMBEDDED_SIGNUP_APP_ID ?? process.env.META_APP_ID ?? "";
  }

  private async get(url: URL, token?: string): Promise<any> {
    try {
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: token ? { Authorization: `Bearer ${token}` } : {} });
      if (!response.ok) throw new TwilioOnboardingError("META_AUTHORIZATION_FAILED");
      return await response.json() as any;
    } catch (error) {
      if (error instanceof TwilioOnboardingError) throw error;
      throw new TwilioOnboardingError("META_AUTHORIZATION_FAILED", true);
    }
  }

  async authorize(input: { code: string; wabaId: string; phoneNumberId: string }): Promise<MetaCloudAuthorizedAssets> {
    const appId = this.appId();
    const secret = process.env.META_APP_SECRET;
    if (!appId || !secret) throw new TwilioOnboardingError("PLATFORM_NOT_CONFIGURED");
    const exchange = new URL(`${this.graph}/oauth/access_token`);
    exchange.searchParams.set("client_id", appId);
    exchange.searchParams.set("client_secret", secret);
    exchange.searchParams.set("code", input.code);
    const exchangeResult = await this.get(exchange);
    const token = exchangeResult.access_token;
    if (typeof token !== "string" || !token) throw new TwilioOnboardingError("META_AUTHORIZATION_FAILED");
    // debug_token proves that the submitted WABA is among the assets granted in
    // this authorization, rather than trusting a WABA supplied by the browser.
    const debug = new URL(`${this.graph}/debug_token`);
    debug.searchParams.set("input_token", token);
    const details = (await this.get(debug, `${appId}|${secret}`)).data;
    if (details?.is_valid !== true || String(details.app_id) !== appId
      || !details.granular_scopes?.some((scope: any) => scope.scope === "whatsapp_business_management"
        && Array.isArray(scope.target_ids) && scope.target_ids.includes(input.wabaId))) {
      throw new TwilioOnboardingError("META_ASSET_NOT_AUTHORIZED");
    }
    const phones = new URL(`${this.graph}/${input.wabaId}/phone_numbers`);
    phones.searchParams.set("fields", "id,display_phone_number");
    phones.searchParams.set("limit", "100");
    for (let page = 0; page < 3; page++) {
      const result = await this.get(phones, token);
      const phone = result.data?.find((row: any) => row.id === input.phoneNumberId);
      const displayPhone = phone && whatsappE164(phone.display_phone_number);
      if (displayPhone) {
        const expiresIn = typeof exchangeResult.expires_in === "number" && exchangeResult.expires_in > 0
          ? new Date(Date.now() + exchangeResult.expires_in * 1000) : undefined;
        return { accessToken: token, tokenExpiresAt: expiresIn, wabaId: input.wabaId,
          phoneNumberId: input.phoneNumberId, whatsappNumber: displayPhone };
      }
      const after = result.paging?.next && result.paging?.cursors?.after;
      if (typeof after !== "string") break;
      phones.searchParams.set("after", after);
    }
    throw new TwilioOnboardingError("META_ASSET_NOT_AUTHORIZED");
  }

  async subscribe(input: Pick<MetaCloudAuthorizedAssets, "accessToken" | "wabaId">): Promise<void> {
    try {
      const response = await fetch(`${this.graph}/${input.wabaId}/subscribed_apps`, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${input.accessToken}` },
      });
      if (!response.ok) throw new TwilioOnboardingError("META_SUBSCRIPTION_FAILED");
      const body = await response.json().catch(() => null) as { success?: unknown } | null;
      if (body?.success !== true) throw new TwilioOnboardingError("META_SUBSCRIPTION_FAILED");
    } catch (error) {
      if (error instanceof TwilioOnboardingError) throw error;
      throw new TwilioOnboardingError("META_SUBSCRIPTION_UNKNOWN", true);
    }
  }

  async isSubscribed(input: Pick<MetaCloudAuthorizedAssets, "accessToken" | "wabaId">): Promise<boolean> {
    const url = new URL(`${this.graph}/${input.wabaId}/subscribed_apps`);
    url.searchParams.set("fields", "id");
    const result = await this.get(url, input.accessToken);
    return Array.isArray(result.data) && result.data.some((app: any) => String(app.id) === this.appId());
  }
}
