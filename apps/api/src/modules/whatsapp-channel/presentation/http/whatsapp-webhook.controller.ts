/**
 * WhatsApp Webhook Controller
 *
 * Receives messages from BubbleWhats and dispatches to the message pipeline.
 * No auth guard — authenticates via webhook secret header.
 * Returns 200 immediately (processing is async via debouncer).
 */

import {
  Body,
  Controller,
  HttpCode,
  Logger,
  Post,
  Headers,
  UnauthorizedException,
  Inject,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../domain/ports/whatsapp-config-repository.port.js";
import { HandleIncomingMessageUseCase } from "../../application/use-cases/handle-incoming-message.use-case.js";
import { HandleStatusUpdateUseCase } from "../../application/use-cases/handle-status-update.use-case.js";

interface BubbleWhatsMessagePayload {
  id: string;
  fromNumber: string;
  fromGroup?: string;
  fromAlias?: string;
  toNumber: string;
  body: string;
  caption?: string;
  isGroup: boolean;
  url?: string;
  mimetype?: string;
  messageContext?: Record<string, unknown>;
  key?: string;
  degreesLatitude?: number;
  degreesLongitude?: number;
  messageType: string;
  deviceID: string;
  timestamp: number;
}

interface BubbleWhatsStatusPayload {
  deviceID: string;
  messages: Array<{
    key: { remoteJid: string; id: string; fromMe: boolean };
    update: { status: number };
  }>;
}

@ApiExcludeController()
@Controller("webhooks/bubblewhats")
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    @Inject(WHATSAPP_CONFIG_REPOSITORY)
    private readonly configRepo: WhatsAppConfigRepository,
    private readonly handleMessage: HandleIncomingMessageUseCase,
    private readonly handleStatus: HandleStatusUpdateUseCase,
  ) {}

  @Post("messages")
  @HttpCode(200)
  async receiveMessage(
    @Headers("x-webhook-secret") secret: string | undefined,
    @Body() payload: BubbleWhatsMessagePayload,
  ): Promise<{ received: true }> {
    // Drop group messages
    if (payload.isGroup) {
      this.logger.debug(`Dropped group message from ${payload.fromNumber}`);
      return { received: true };
    }

    // Drop messages from self (fromMe)
    if (payload.messageContext?.key && (payload.messageContext.key as any).fromMe === true) {
      return { received: true };
    }

    // Verify webhook secret against merchant config
    const config = await this.configRepo.findByDeviceId(payload.deviceID);
    if (!config) {
      this.logger.warn(`Unknown deviceID: ${payload.deviceID}`);
      return { received: true };
    }

    if (!config.enabled) {
      this.logger.debug(`WhatsApp channel disabled for merchant ${config.merchantId}`);
      return { received: true };
    }

    if (secret && secret !== config.webhookSecret) {
      throw new UnauthorizedException("invalid_webhook_secret");
    }

    // Dispatch async (debouncer handles batching)
    void this.handleMessage.execute({
      merchantId: config.merchantId,
      deviceId: payload.deviceID,
      fromNumber: payload.fromNumber,
      fromAlias: payload.fromAlias,
      body: payload.body ?? payload.caption ?? "",
      messageType: payload.messageType,
      mediaUrl: payload.url,
      mimetype: payload.mimetype,
      timestamp: payload.timestamp,
    });

    return { received: true };
  }

  @Post("status")
  @HttpCode(200)
  async receiveStatus(
    @Headers("x-webhook-secret") secret: string | undefined,
    @Body() payload: BubbleWhatsStatusPayload,
  ): Promise<{ received: true }> {
    const config = await this.configRepo.findByDeviceId(payload.deviceID);
    if (!config) return { received: true };

    if (secret && secret !== config.webhookSecret) {
      throw new UnauthorizedException("invalid_webhook_secret");
    }

    void this.handleStatus.execute({
      merchantId: config.merchantId,
      deviceId: payload.deviceID,
      messages: payload.messages,
    });

    return { received: true };
  }
}
