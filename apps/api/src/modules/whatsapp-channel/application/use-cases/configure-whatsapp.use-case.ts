/**
 * Configure WhatsApp for a merchant.
 *
 * Multi-tenant pattern:
 * - Platform owns ONE Twilio account (env: TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN)
 * - Each merchant registers their OWN phone number as a WhatsApp sender
 * - Merchant only provides phone number — platform credentials handle the rest
 *
 * Flow:
 * 1. Merchant submits phone number from dashboard
 * 2. Backend uses platform Twilio credentials to register the number as sender
 * 3. Twilio sends OTP to that phone for verification
 * 4. Merchant enters OTP → status moves to ACTIVE
 * 5. Webhook URL registered on Twilio for inbound messages
 */

import { Injectable, Inject, Logger } from "@nestjs/common";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../domain/ports/whatsapp-config-repository.port.js";

export interface ConnectWhatsAppInput {
  merchantId: string;
  phoneNumber: string; // raw digits: "5521993001883" or "21993001883"
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

  constructor(
    @Inject(WHATSAPP_CONFIG_REPOSITORY)
    private readonly configRepo: WhatsAppConfigRepository,
  ) {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
    this.authToken = process.env.TWILIO_AUTH_TOKEN ?? "";
  }

  /**
   * Step 1: Register merchant's phone as WhatsApp sender.
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
   * Register phone as WhatsApp sender via Twilio Channels API.
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
      // For now, we store the config and let merchant use BubbleWhats fallback
      if (errData.code === 63100) {
        this.logger.warn("WABA ID required — Embedded Signup needed. Saving config as pending.");
        return { success: true }; // Store anyway, activate manually later
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
}
