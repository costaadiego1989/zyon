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

  @Get("connection")
  async getConnection(@Param("merchantId") merchantId: string) {
    const config = await this.configRepo.findByMerchantId(merchantId);

    if (!config) {
      return {
        status: "disconnected",
        enabled: false,
        provider: "TWILIO",
        whatsappNumber: null,
        connectedAt: null,
      };
    }

    return {
      status: config.status?.toLowerCase() ?? "disconnected",
      enabled: config.enabled,
      provider: config.provider ?? "TWILIO",
      whatsappNumber: config.whatsappNumber,
      connectedAt: config.connectedAt,
    };
  }

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

  @Post("disconnect")
  @HttpCode(200)
  async disconnect(@Param("merchantId") merchantId: string) {
    return this.configureWhatsApp.disconnect(merchantId);
  }

  @Post("toggle")
  @HttpCode(200)
  async toggle(
    @Param("merchantId") merchantId: string,
    @Body() body: { enabled: boolean },
  ) {
    const config = await this.configRepo.findByMerchantId(merchantId);
    if (!config) return { status: "disconnected", enabled: false };

    const result = await this.configureWhatsApp.setEnabled(merchantId, body.enabled);
    return {
      ...result,
      whatsappNumber: config.whatsappNumber,
      connectedAt: config.connectedAt,
    };
  }

  @Post("test")
  @HttpCode(200)
  async sendTest(@Param("merchantId") merchantId: string) {
    const config = await this.configRepo.findByMerchantId(merchantId);
    if (!config?.enabled || !config.whatsappNumber) {
      return { status: "NOT_ACTIVE" };
    }

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
