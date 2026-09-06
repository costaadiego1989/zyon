/**
 * WhatsApp Webhook Controller
 *
 * Receives messages from BubbleWhats and Twilio and dispatches to the message pipeline.
 * No auth guard — authenticates via webhook secret header (BubbleWhats) or HMAC signature (Twilio).
 * BubbleWhats acknowledges only after durable inbox persistence.
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
import { AcceptBubbleWhatsWebhookUseCase } from "../../application/use-cases/accept-bubblewhats-webhook.use-case.js";
import { validateTwilioSignature } from "../../domain/services/twilio-signature-validator.js";
import { parseTwilioInbound } from "../../infrastructure/adapters/twilio-webhook-parser.js";
import { TwilioDeduplicatorService } from "../../infrastructure/services/twilio-deduplicator.service.js";

@ApiExcludeController()
@Controller("webhooks/whatsapp")
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    @Inject(WHATSAPP_CONFIG_REPOSITORY)
    private readonly configRepo: WhatsAppConfigRepository,
    private readonly handleMessage: HandleIncomingMessageUseCase,
    private readonly acceptBubbleWhats: AcceptBubbleWhatsWebhookUseCase,
    private readonly deduplicator: TwilioDeduplicatorService,
  ) {}

  @Post("bubblewhats/messages")
  @HttpCode(200)
  async receiveBubbleWhatsMessage(
    @Headers("x-webhook-secret") secret: string | undefined,
    @Body() payload: unknown,
  ): Promise<{ received: true }> {
    return this.acceptBubbleWhats.message(secret, payload);
  }

  @Post("bubblewhats/status")
  @HttpCode(200)
  async receiveBubbleWhatsStatus(
    @Headers("x-webhook-secret") secret: string | undefined,
    @Body() payload: unknown,
  ): Promise<{ received: true }> {
    return this.acceptBubbleWhats.status(secret, payload);
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
      await this.handleMessage.execute({
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

