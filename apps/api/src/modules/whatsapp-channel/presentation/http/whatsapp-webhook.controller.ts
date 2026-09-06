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
  Get,
  HttpCode,
  Logger,
  Post,
  Headers,
  Query,
  Res,
  UnauthorizedException,
  Inject,
  Req,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../domain/ports/whatsapp-config-repository.port.js";
import { HandleIncomingMessageUseCase } from "../../application/use-cases/handle-incoming-message.use-case.js";
import { AcceptBubbleWhatsWebhookUseCase } from "../../application/use-cases/accept-bubblewhats-webhook.use-case.js";
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

interface MetaInboundMessage {
  id?: string;
  from?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  button?: { text?: string };
  interactive?: { button_reply?: { title?: string }; list_reply?: { title?: string } };
}

interface MetaWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{ profile?: { name?: string } }>;
        messages?: MetaInboundMessage[];
      };
    }>;
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
    private readonly acceptBubbleWhats: AcceptBubbleWhatsWebhookUseCase,
    private readonly deduplicator: TwilioDeduplicatorService,
  ) {}

  @Get("meta")
  verifyMetaWebhook(
    @Query() query: Record<string, string | undefined>,
    @Res() response: Response,
  ): void {
    const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
    if (
      query["hub.mode"] !== "subscribe" ||
      !verifyToken ||
      query["hub.verify_token"] !== verifyToken ||
      !query["hub.challenge"]
    ) {
      response.sendStatus(403);
      return;
    }

    response.status(200).send(query["hub.challenge"]);
  }

  @Post("meta")
  @HttpCode(200)
  async receiveMetaWebhook(
    @Headers("x-hub-signature-256") signature: string | undefined,
    @Body() payload: MetaWebhookPayload,
    @Req() request: Request,
  ): Promise<{ received: true }> {
    const rawBody = (request as Request & { rawBody?: Buffer }).rawBody;
    if (!this.isValidMetaSignature(signature, rawBody)) {
      throw new UnauthorizedException("invalid_meta_signature");
    }

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;

        const phoneNumberId = change.value?.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        const config = await this.configRepo.findByMetaPhoneNumberId(phoneNumberId);
        if (!config || !config.enabled) continue;

        const senderName = change.value?.contacts?.[0]?.profile?.name;
        for (const message of change.value?.messages ?? []) {
          if (!message.id || !message.from || this.deduplicator.isDuplicate("META", message.id)) continue;
          this.deduplicator.mark("META", message.id);

          const body = this.metaMessageBody(message);
          if (!body) {
            this.logger.debug(`Ignored unsupported Meta message ${message.id}`);
            continue;
          }

          void this.handleMessage.execute({
            merchantId: config.merchantId,
            deviceId: `twilio:${config.id}`,
            fromNumber: message.from.startsWith("+") ? message.from : `+${message.from}`,
            fromAlias: senderName,
            body,
            messageType: message.type ?? "text",
            timestamp: Number(message.timestamp ?? 0) * 1000 || Date.now(),
            provider: "TWILIO",
          });
        }
      }
    }

    return { received: true };
  }

  private isValidMetaSignature(signature: string | undefined, rawBody: Buffer | undefined): boolean {
    const secret = process.env.META_APP_SECRET;
    if (!signature || !rawBody || !secret) return false;

    const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    const received = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return received.length === expectedBuffer.length && timingSafeEqual(received, expectedBuffer);
  }

  private metaMessageBody(message: MetaInboundMessage): string {
    return message.text?.body
      ?? message.button?.text
      ?? message.interactive?.button_reply?.title
      ?? message.interactive?.list_reply?.title
      ?? "";
  }

  /**
   * BubbleWhats message webhook (legacy, kept for backward compat).
   */
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

