/**
 * WhatsApp Config Controller — Dashboard endpoints.
 * Merchant-facing: Embedded Signup via Meta + Twilio integration.
 * Platform credentials from env vars handle the Twilio/Meta integration.
 */

import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  HttpCode,
  Logger,
  Inject,
} from "@nestjs/common";
import { AuthGuard } from "../../../../modules/auth/presentation/auth.guard.js";
import { ConfigureWhatsAppUseCase } from "../../application/use-cases/configure-whatsapp.use-case.js";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../domain/ports/whatsapp-config-repository.port.js";

@Controller("merchants/:merchantId/whatsapp")
@UseGuards(AuthGuard)
export class WhatsAppConfigController {
  private readonly logger = new Logger(WhatsAppConfigController.name);

  constructor(
    private readonly configureWhatsApp: ConfigureWhatsAppUseCase,
    @Inject(WHATSAPP_CONFIG_REPOSITORY)
    private readonly configRepo: WhatsAppConfigRepository,
  ) {}

  /**
   * Get current WhatsApp connection status.
   */
  @Get("connection")
  async getConnection(@Param("merchantId") merchantId: string) {
    const config = await this.configRepo.findByMerchantId(merchantId);

    if (!config) {
      return {
        status: "disconnected",
        enabled: false,
        provider: null,
        whatsappNumber: null,
        connectedAt: null,
      };
    }

    return {
      status: config.status?.toLowerCase() ?? "disconnected",
      enabled: config.enabled,
      provider: config.provider,
      whatsappNumber: config.whatsappNumber,
      connectedAt: config.connectedAt,
    };
  }

  /**
   * Connect WhatsApp via Meta Embedded Signup (production flow).
   * Frontend passes OAuth code + WABA/phone IDs from the Meta popup.
   */
  @Post("meta/connect")
  @HttpCode(200)
  async connectViaEmbeddedSignup(
    @Param("merchantId") merchantId: string,
    @Body() body: { code: string; wabaId: string; phoneNumberId: string },
  ) {
    if (!body.code?.trim()) {
      return { status: "MISSING_CODE" };
    }
    if (!body.wabaId?.trim()) {
      return { status: "MISSING_WABA_ID" };
    }
    if (!body.phoneNumberId?.trim()) {
      return { status: "MISSING_PHONE_NUMBER_ID" };
    }

    return this.configureWhatsApp.connectViaEmbeddedSignup({
      merchantId,
      code: body.code.trim(),
      wabaId: body.wabaId.trim(),
      phoneNumberId: body.phoneNumberId.trim(),
    });
  }

  /**
   * Legacy: Connect WhatsApp — merchant provides phone number only.
   * Kept for backward compatibility; may fail with WABA_ID_REQUIRED.
   */
  @Post("twilio/connect")
  @HttpCode(200)
  async connectTwilio(
    @Param("merchantId") merchantId: string,
    @Body() body: { phoneNumber: string; provider?: string },
  ) {
    if (!body.phoneNumber?.trim()) {
      return { status: "MISSING_PHONE" };
    }

    const result = await this.configureWhatsApp.connect({
      merchantId,
      phoneNumber: body.phoneNumber,
    });

    return result;
  }

  /**
   * Verify OTP code for WhatsApp sender.
   */
  @Post("twilio/verify")
  @HttpCode(200)
  async verifyOtp(
    @Param("merchantId") merchantId: string,
    @Body() body: { code: string },
  ) {
    if (!body.code?.trim()) {
      return { status: "MISSING_CODE" };
    }

    return this.configureWhatsApp.verify({ merchantId, code: body.code.trim() });
  }

  /**
   * Disconnect WhatsApp channel.
   */
  @Post("disconnect")
  @HttpCode(200)
  async disconnect(@Param("merchantId") merchantId: string) {
    await this.configRepo.upsert(merchantId, {
      enabled: false,
      status: "DISCONNECTED",
    });

    this.logger.log(`WhatsApp disconnected for merchant ${merchantId}`);
    return { status: "disconnected", enabled: false };
  }

  /**
   * Toggle WhatsApp enabled/disabled.
   */
  @Post("toggle")
  @HttpCode(200)
  async toggle(
    @Param("merchantId") merchantId: string,
    @Body() body: { enabled: boolean },
  ) {
    const config = await this.configRepo.findByMerchantId(merchantId);
    if (!config) return { status: "disconnected", enabled: false };

    await this.configRepo.upsert(merchantId, { enabled: body.enabled });
    return {
      status: config.status?.toLowerCase() ?? "disconnected",
      enabled: body.enabled,
      whatsappNumber: config.whatsappNumber,
      connectedAt: config.connectedAt,
    };
  }

  /**
   * Send test message to merchant's own number.
   */
  @Post("test")
  @HttpCode(200)
  async sendTest(@Param("merchantId") merchantId: string) {
    const config = await this.configRepo.findByMerchantId(merchantId);
    if (!config?.enabled || !config.whatsappNumber) {
      return { status: "NOT_ACTIVE" };
    }

    // Send test via the existing sender adapter
    const { BubbleWhatsSenderAdapter } = await import("../../infrastructure/adapters/bubblewhats-sender.adapter.js");
    const sender = new BubbleWhatsSenderAdapter();
    const result = await sender.sendText({
      toNumber: config.whatsappNumber,
      deviceId: config.deviceId ?? "",
      text: "✅ Teste de conexão — WhatsApp Seller funcionando!",
    });

    return { status: result.status === "sent" ? "SENT" : "FAILED" };
  }
}
