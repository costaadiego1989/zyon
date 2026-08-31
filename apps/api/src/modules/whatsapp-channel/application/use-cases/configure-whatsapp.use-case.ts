/**
 * Configure WhatsApp for a merchant via Meta Embedded Signup + Twilio.
 *
 * Production ISV flow:
 * 1. Merchant clicks "Conectar WhatsApp" in dashboard
 * 2. Meta Embedded Signup popup opens → merchant logs into Facebook → creates/selects WABA → picks phone
 * 3. Popup returns: { code, wabaId, phoneNumberId }
 * 4. Backend exchanges `code` for Meta access token
 * 5. Backend subscribes app to WABA webhooks via Meta Graph API
 * 6. Backend registers sender on Twilio with waba_id
 * 7. Twilio sends SMS verification to the phone
 * 8. Merchant enters OTP → status moves to ACTIVE
 *
 * Multi-tenant pattern:
 * - Platform owns ONE Twilio account (env: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN)
 * - Platform owns ONE Meta App (env: META_APP_ID + META_APP_SECRET)
 * - Each merchant registers their OWN WABA + phone via Embedded Signup
 */

import { Injectable, Inject, Logger } from "@nestjs/common";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../domain/ports/whatsapp-config-repository.port.js";

// ─── Legacy flow (phone-only, kept for backward compat) ───────────────────────
export interface ConnectWhatsAppInput {
  merchantId: string;
  phoneNumber: string; // raw digits: "5521993001883" or "21993001883"
}

// ─── New flow: Meta Embedded Signup ───────────────────────────────────────────
export interface ConnectViaEmbeddedSignupInput {
  merchantId: string;
  code: string;           // OAuth code from FB.login()
  wabaId: string;         // from authResponse.extras.setup.waba_id
  phoneNumberId: string;  // from authResponse.extras.setup.phone_number_id
}

export interface VerifyWhatsAppInput {
  merchantId: string;
  code: string;
}

@Injectable()
export class ConfigureWhatsAppUseCase {
  private readonly logger = new Logger(ConfigureWhatsAppUseCase.name);
  private readonly accountSid: string;
  private readonly authToken: string;
  private readonly metaAppId: string;
  private readonly metaAppSecret: string;

  constructor(
    @Inject(WHATSAPP_CONFIG_REPOSITORY)
    private readonly configRepo: WhatsAppConfigRepository,
  ) {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
    this.authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
    this.metaAppId = process.env.META_APP_ID ?? process.env.TWILIO_EMBEDDED_SIGNUP_APP_ID ?? "";
    this.metaAppSecret = process.env.META_APP_SECRET ?? "";
  }

  // ─── NEW: Embedded Signup flow ──────────────────────────────────────────────

  /**
   * Connect via Meta Embedded Signup.
   * Receives OAuth code + WABA/phone from the frontend popup.
   */
  async connectViaEmbeddedSignup(input: ConnectViaEmbeddedSignupInput): Promise<{ status: string; whatsappNumber?: string }> {
    if (!this.accountSid || !this.authToken) {
      this.logger.error("Platform Twilio credentials not configured");
      return { status: "PLATFORM_NOT_CONFIGURED" };
    }
    if (!this.metaAppId || !this.metaAppSecret) {
      this.logger.error("Meta App credentials not configured (META_APP_ID / META_APP_SECRET)");
      return { status: "PLATFORM_NOT_CONFIGURED" };
    }

    try {
      // Step 1: Exchange code for long-lived Meta access token
      const accessToken = await this.exchangeCodeForToken(input.code);
      if (!accessToken) {
        return { status: "TOKEN_EXCHANGE_FAILED" };
      }

      // Step 2: Get phone number details from Meta Graph API
      const phoneInfo = await this.getPhoneNumberInfo(input.phoneNumberId, accessToken);
      if (!phoneInfo) {
        return { status: "PHONE_LOOKUP_FAILED" };
      }

      // Step 3: Subscribe app to WABA webhooks
      await this.subscribeToWaba(input.wabaId, accessToken);

      // Step 4: Register sender on Twilio with waba_id
      const registerResult = await this.registerTwilioSenderWithWaba(phoneInfo.number, input.wabaId);

      // Step 5: Store config
      const senderId = `whatsapp:+${phoneInfo.number}`;
      await this.configRepo.upsert(input.merchantId, {
        provider: "TWILIO",
        credentials: {
          accountSid: this.accountSid,
          authToken: this.authToken,
          senderId,
          senderStatus: "PENDING",
          wabaId: input.wabaId,
          metaAccessToken: accessToken,
          phoneNumberId: input.phoneNumberId,
        },
        whatsappNumber: phoneInfo.number,
        status: registerResult.alreadyActive ? "ACTIVE" : "PENDING_VERIFICATION",
        enabled: registerResult.alreadyActive ?? false,
        connectedAt: registerResult.alreadyActive ? new Date() : undefined,
      });

      if (registerResult.alreadyActive) {
        this.logger.log(`WhatsApp connected (already active) for merchant ${input.merchantId}`);
        return { status: "active", whatsappNumber: phoneInfo.number };
      }

      this.logger.log(`WhatsApp sender registered for ${phoneInfo.number}, awaiting SMS verification`);
      return { status: "pending_verification", whatsappNumber: phoneInfo.number };
    } catch (error) {
      this.logger.error(`Embedded Signup connect error: ${error instanceof Error ? error.message : String(error)}`);
      return { status: "ERROR" };
    }
  }

  /**
   * Exchange Meta OAuth code for a long-lived access token.
   */
  private async exchangeCodeForToken(code: string): Promise<string | null> {
    try {
      const url = new URL("https://graph.facebook.com/v21.0/oauth/access_token");
      url.searchParams.set("client_id", this.metaAppId);
      url.searchParams.set("client_secret", this.metaAppSecret);
      url.searchParams.set("code", code);

      const res = await fetch(url.toString());
      if (!res.ok) {
        const err = await res.text();
        this.logger.error(`Meta token exchange failed: ${res.status} — ${err}`);
        return null;
      }

      const data = await res.json() as { access_token?: string };
      return data.access_token ?? null;
    } catch (error) {
      this.logger.error(`Meta token exchange error: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Get phone number details from Meta Graph API.
   */
  private async getPhoneNumberInfo(phoneNumberId: string, accessToken: string): Promise<{ number: string; displayName?: string } | null> {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${phoneNumberId}?fields=display_phone_number,verified_name`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );

      if (!res.ok) {
        const err = await res.text();
        this.logger.error(`Meta phone lookup failed: ${res.status} — ${err}`);
        return null;
      }

      const data = await res.json() as { display_phone_number?: string; verified_name?: string };
      const rawNumber = data.display_phone_number?.replace(/[\s\-()+ ]/g, "") ?? "";
      if (!rawNumber) return null;

      // Normalize to digits with country code
      const number = rawNumber.startsWith("55") ? rawNumber : `55${rawNumber}`;
      return { number, displayName: data.verified_name };
    } catch (error) {
      this.logger.error(`Meta phone lookup error: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Subscribe platform app to WABA webhooks via Meta Graph API.
   */
  private async subscribeToWaba(wabaId: string, accessToken: string): Promise<void> {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v21.0/${wabaId}/subscribed_apps`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${accessToken}` },
        },
      );

      if (!res.ok) {
        const err = await res.text();
        this.logger.warn(`WABA subscription response: ${res.status} — ${err}`);
      } else {
        this.logger.log(`Subscribed to WABA ${wabaId} webhooks`);
      }
    } catch (error) {
      // Non-fatal: messages may still flow via Twilio webhook
      this.logger.warn(`WABA subscription error (non-fatal): ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Register sender on Twilio Channels API WITH waba_id (Embedded Signup path).
   */
  private async registerTwilioSenderWithWaba(phone: string, wabaId: string): Promise<{ success: boolean; alreadyActive?: boolean; error?: string }> {
    const authBase64 = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");

    try {
      // Check if sender already exists
      const listRes = await fetch(
        `https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp&SenderIds=whatsapp:+${phone}`,
        { headers: { Authorization: `Basic ${authBase64}` } },
      );

      if (listRes.ok) {
        const listData = await listRes.json() as any;
        const existing = listData.senders?.find((s: any) => s.sender_id === `whatsapp:+${phone}`);
        if (existing?.status === "ONLINE" || existing?.status === "ACTIVE") {
          return { success: true, alreadyActive: true };
        }
      }

      // Register new sender WITH waba_id
      const res = await fetch(`https://messaging.twilio.com/v2/Channels/Senders`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${authBase64}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender_id: `whatsapp:+${phone}`,
          channel: "whatsapp",
          configuration: {
            waba_id: wabaId,
            verification_method: "sms",
          },
          profile: { name: "Commerce Bot" },
          webhook: {
            callback_url: `${process.env.API_PUBLIC_URL || "https://api.aacp.com"}/v1/webhooks/whatsapp/twilio`,
            callback_method: "POST",
          },
        }),
      });

      if (res.ok || res.status === 201) {
        return { success: true };
      }

      const errData = await res.json().catch(() => ({})) as any;
      this.logger.warn(`Twilio sender registration: ${errData.message || `HTTP ${res.status}`}`);
      return { success: false, error: errData.message || `HTTP ${res.status}` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ─── LEGACY: Phone-only flow (backward compat) ─────────────────────────────

  /**
   * Step 1: Register merchant's phone as WhatsApp sender (legacy — no WABA).
   * Uses platform Twilio credentials.
   */
  async connect(input: ConnectWhatsAppInput): Promise<{ status: string; whatsappNumber?: string }> {
    // Normalize phone
    const phone = this.normalizePhone(input.phoneNumber);
    const senderId = `whatsapp:+${phone}`;

    if (!this.accountSid || !this.authToken) {
      this.logger.error("Platform Twilio credentials not configured");
      return { status: "PLATFORM_NOT_CONFIGURED" };
    }

    try {
      // Store config immediately (pending verification)
      await this.configRepo.upsert(input.merchantId, {
        provider: "TWILIO",
        credentials: {
          accountSid: this.accountSid,
          authToken: this.authToken,
          senderId,
          senderStatus: "PENDING",
        },
        whatsappNumber: phone,
        status: "PENDING_VERIFICATION",
        enabled: false,
      });

      // Register sender on Twilio (async — may take time)
      const registerResult = await this.registerTwilioSender(phone);

      if (registerResult.success) {
        this.logger.log(`WhatsApp sender registered for ${phone}, awaiting verification`);
        return { status: "pending_verification", whatsappNumber: phone };
      }

      // If sender already exists or is active, skip verification
      if (registerResult.alreadyActive) {
        await this.configRepo.upsert(input.merchantId, {
          status: "ACTIVE",
          enabled: true,
          connectedAt: new Date(),
        });
        return { status: "active", whatsappNumber: phone };
      }

      // Registration failed but credentials are valid — save anyway for retry
      this.logger.warn(`Sender registration issue: ${registerResult.error}`);
      return { status: "pending_verification", whatsappNumber: phone };

    } catch (error) {
      this.logger.error(`Connect WhatsApp error: ${error instanceof Error ? error.message : String(error)}`);
      return { status: "ERROR" };
    }
  }

  /**
   * Step 2: Verify OTP code sent to merchant's phone.
   */
  async verify(input: VerifyWhatsAppInput): Promise<{ status: string }> {
    const config = await this.configRepo.findByMerchantId(input.merchantId);
    if (!config || config.status !== "PENDING_VERIFICATION") {
      return { status: "NOT_PENDING" };
    }

    try {
      const phone = config.whatsappNumber!;
      const verified = await this.verifyTwilioSender(phone, input.code);

      if (verified) {
        await this.configRepo.upsert(input.merchantId, {
          status: "ACTIVE",
          enabled: true,
          connectedAt: new Date(),
        });
        this.logger.log(`WhatsApp verified and active for merchant ${input.merchantId}`);
        return { status: "active" };
      }

      return { status: "INVALID_CODE" };
    } catch (error) {
      this.logger.error(`Verify error: ${error instanceof Error ? error.message : String(error)}`);
      return { status: "VERIFICATION_FAILED" };
    }
  }

  /**
   * Register phone as WhatsApp sender via Twilio Channels API (legacy, no waba_id).
   */
  private async registerTwilioSender(phone: string): Promise<{ success: boolean; alreadyActive?: boolean; error?: string }> {
    const authBase64 = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");

    try {
      // Check if sender already exists
      const listRes = await fetch(
        `https://messaging.twilio.com/v2/Channels/Senders?Channel=whatsapp&SenderIds=whatsapp:+${phone}`,
        { headers: { Authorization: `Basic ${authBase64}` } },
      );

      if (listRes.ok) {
        const listData = await listRes.json() as any;
        const existing = listData.senders?.find((s: any) => s.sender_id === `whatsapp:+${phone}`);
        if (existing?.status === "ONLINE" || existing?.status === "ACTIVE") {
          return { success: true, alreadyActive: true };
        }
      }

      // Register new sender
      const res = await fetch(`https://messaging.twilio.com/v2/Channels/Senders`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${authBase64}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender_id: `whatsapp:+${phone}`,
          channel: "whatsapp",
          configuration: { verification_method: "sms" },
          profile: { name: "Commerce Bot" },
          webhook: {
            callback_url: `${process.env.API_PUBLIC_URL || "https://api.aacp.com"}/v1/webhooks/whatsapp/twilio`,
            callback_method: "POST",
          },
        }),
      });

      if (res.ok || res.status === 201) {
        return { success: true };
      }

      const errData = await res.json().catch(() => ({})) as any;
      // 63100 = waba_id required (need Embedded Signup first)
      if (errData.code === 63100) {
        this.logger.warn("WABA ID required — use Embedded Signup flow instead.");
        return { success: false, error: "WABA_ID_REQUIRED" };
      }

      return { success: false, error: errData.message || `HTTP ${res.status}` };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  /**
   * Verify sender OTP via Twilio API.
   */
  private async verifyTwilioSender(phone: string, code: string): Promise<boolean> {
    const authBase64 = Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64");

    try {
      const res = await fetch(`https://messaging.twilio.com/v2/Channels/Senders/whatsapp:+${phone}/Verification`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${authBase64}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ verification_code: code }),
      });

      return res.ok;
    } catch {
      return false;
    }
  }

  private normalizePhone(phone: string): string {
    const digits = phone.replace(/\D/g, "");
    if (digits.startsWith("55") && digits.length >= 12) return digits;
    if (digits.length === 10 || digits.length === 11) return `55${digits}`;
    return digits;
  }

  async disconnect(merchantId: string): Promise<{ status: string; enabled: boolean }> {
    await this.configRepo.upsert(merchantId, { enabled: false, status: "DISCONNECTED" });
    this.logger.log(`WhatsApp disconnected for merchant ${merchantId}`);
    return { status: "disconnected", enabled: false };
  }

  async setEnabled(merchantId: string, enabled: boolean): Promise<{ status: string; enabled: boolean }> {
    const config = await this.configRepo.findByMerchantId(merchantId);
    if (!config) return { status: "disconnected", enabled: false };
    await this.configRepo.upsert(merchantId, { enabled });
    return {
      status: config.status?.toLowerCase() ?? "disconnected",
      enabled,
    };
  }
}
