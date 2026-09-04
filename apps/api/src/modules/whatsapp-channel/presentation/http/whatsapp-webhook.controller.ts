/**
 * WhatsApp Webhook Controller
 *
 * Receives messages from BubbleWhats and Twilio and dispatches to the message pipeline.
 * No auth guard — authenticates via webhook secret header (BubbleWhats) or HMAC signature (Twilio).
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
  Req,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import type { Request } from "express";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../domain/ports/whatsapp-config-repository.port.js";
import { HandleIncomingMessageUseCase } from "../../application/use-cases/handle-incoming-message.use-case.js";
import { HandleStatusUpdateUseCase } from "../../application/use-cases/handle-status-update.use-case.js";
import { validateTwilioSignature } from "../../domain/services/twilio-signature-validator.js";
import { parseTwilioInbound } from "../../infrastructure/adapters/twilio-webhook-parser.js";
import { TwilioDeduplicatorService } from "../../infrastructure/services/twilio-deduplicator.service.js";

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
@Controller("webhooks/whatsapp")
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    @Inject(WHATSAPP_CONFIG_REPOSITORY)
    private readonly configRepo: WhatsAppConfigRepository,
    private readonly handleMessage: HandleIncomingMessageUseCase,
    private readonly handleStatus: HandleStatusUpdateUseCase,
    private readonly deduplicator: TwilioDeduplicatorService,
  ) {}

  /**
   * BubbleWhats message webhook (legacy, kept for backward compat).
   */
  @Post("bubblewhats/messages")
  @HttpCode(200)
  async receiveBubbleWhatsMessage(
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

    // P1 fix: webhook secret validation must be REQUIRED if configured.
    // If config.webhookSecret exists, demand the header (fail-closed).
    if (config.webhookSecret) {
      if (!secret || secret !== config.webhookSecret) {
        throw new UnauthorizedException("webhook_secret_invalid");
      }
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
      provider: "BUBBLEWHATS",
    });

    return { received: true };
  }

  /**
   * BubbleWhats status webhook (legacy).
   */
  @Post("bubblewhats/status")
  @HttpCode(200)
  async receiveBubbleWhatsStatus(
    @Headers("x-webhook-secret") secret: string | undefined,
    @Body() payload: BubbleWhatsStatusPayload,
  ): Promise<{ received: true }> {
    const config = await this.configRepo.findByDeviceId(payload.deviceID);
    if (!config) return { received: true };

    // P1 fix: webhook secret validation must be REQUIRED if configured.
    if (config.webhookSecret) {
      if (!secret || secret !== config.webhookSecret) {
        throw new UnauthorizedException("webhook_secret_invalid");
      }
    }

    void this.handleStatus.execute({
      merchantId: config.merchantId,
      deviceId: payload.deviceID,
      messages: payload.messages,
    });

    return { received: true };
  }

  /**
   * Twilio WhatsApp message webhook.
   * Receives form-encoded POST body with HMAC-SHA1 signature validation.
   */
  @Post("twilio")
  @HttpCode(200)
  async receiveTwilioMessage(
    @Headers("x-twilio-signature") signature: string | undefined,
    @Body() body: Record<string, string>,
    @Req() req: Request,
  ): Promise<string> {
    try {
      // 1. Parse Twilio inbound
      const normalized = parseTwilioInbound(body);
      if (!normalized) {
        this.logger.warn("Failed to parse Twilio webhook body");
        return ""; // TwiML empty response
      }

      // 2. Deduplicate by MessageSid
      if (this.deduplicator.isDuplicate("TWILIO", normalized.messageSid)) {
        return "";
      }
      this.deduplicator.mark("TWILIO", normalized.messageSid);

      // 3. Lookup merchant by toNumber
      const config = await this.configRepo.findByWhatsAppNumber(normalized.toNumber);
      if (!config) {
        this.logger.warn(`Unknown Twilio recipient number: ${normalized.toNumber}`);
        return "";
      }

      if (!config.enabled) {
        this.logger.debug(`WhatsApp channel disabled for merchant ${config.merchantId}`);
        return "";
      }

      // 4. Validate signature with merchant's authToken
      if (signature && config.credentials) {
        const creds = config.credentials as Record<string, unknown>;
        const authToken = String(creds.authToken ?? "");
        if (authToken) {
          const requestUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
          if (!validateTwilioSignature(signature, requestUrl, body, authToken)) {
            this.logger.warn(`Twilio signature validation failed for ${config.merchantId}`);
            throw new UnauthorizedException("invalid_twilio_signature");
          }
        }
      }

      // 5. Dispatch to message pipeline
      void this.handleMessage.execute({
        merchantId: config.merchantId,
        deviceId: `twilio:${config.id}`, // pseudo-deviceId for routing
        fromNumber: normalized.fromNumber,
        fromAlias: normalized.fromAlias,
        body: normalized.body,
        messageType: "text",
        mediaUrl: normalized.mediaUrl,
        mimetype: normalized.mimetype,
        timestamp: normalized.timestamp,
        provider: "TWILIO",
      });

      // 6. Return empty TwiML (no auto-response via TwiML — we send via adapter)
      return "";
    } catch (error) {
      this.logger.error(`Twilio webhook error: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
}

