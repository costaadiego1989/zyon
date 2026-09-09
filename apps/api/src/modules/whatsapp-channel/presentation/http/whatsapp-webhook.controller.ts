/**
 * WhatsApp Webhook Controller
 *
 * Receives messages from Meta Cloud API and legacy providers, then dispatches to the message pipeline.
 * No auth guard — authenticates via webhook secret header or provider HMAC signature.
 * BubbleWhats acknowledges only after durable inbox persistence.
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Headers,
  Query,
  Res,
  UnauthorizedException,
  Inject,
  Req,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../domain/ports/whatsapp-config-repository.port.js";
import { AcceptBubbleWhatsWebhookUseCase } from "../../application/use-cases/accept-bubblewhats-webhook.use-case.js";
import { validateTwilioSignature } from "../../domain/services/twilio-signature-validator.js";
import { parseTwilioInbound } from "../../infrastructure/adapters/twilio-webhook-parser.js";
import { twilioWhatsAppCallbackUrl } from "../../domain/services/public-url.js";

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
  constructor(
    @Inject(WHATSAPP_CONFIG_REPOSITORY)
    private readonly configRepo: WhatsAppConfigRepository,
    private readonly acceptBubbleWhats: AcceptBubbleWhatsWebhookUseCase,
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
          if (!message.id || !message.from) continue;

          const body = this.metaMessageBody(message);
          if (!body) {
            continue;
          }

          await this.acceptBubbleWhats.messageForAuthenticatedConfig(config, "META", message.id, {
            fromNumber: message.from.startsWith("+") ? message.from : `+${message.from}`,
            fromAlias: senderName,
            body,
            messageType: message.type ?? "text",
            timestamp: Number(message.timestamp ?? 0) * 1000 || Date.now(),
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
    const normalized = parseTwilioInbound(body);
    if (!normalized) return "";

    const config = await this.configRepo.findByWhatsAppNumber(normalized.toNumber);
    if (!config || !config.enabled || config.status !== "ACTIVE" || config.provider !== "TWILIO") return "";
    if (config.credentials.onboardingVersion === 2 && body.AccountSid !== config.credentials.accountSid) {
      throw new UnauthorizedException("invalid_twilio_account");
    }

    const authToken = String(config.credentials?.authToken ?? "");
    if (!signature || !authToken) {
      throw new ServiceUnavailableException("twilio_webhook_auth_not_configured");
    }
    const requestUrl = twilioWhatsAppCallbackUrl() ?? `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    if (!validateTwilioSignature(signature, requestUrl, body, authToken)) {
      throw new UnauthorizedException("invalid_twilio_signature");
    }

    await this.acceptBubbleWhats.messageForAuthenticatedConfig(config, "TWILIO", normalized.messageSid, {
      fromNumber: normalized.fromNumber,
      fromAlias: normalized.fromAlias,
      body: normalized.body,
      messageType: "text",
      mediaUrl: normalized.mediaUrl,
      mimetype: normalized.mimetype,
      timestamp: normalized.timestamp,
    });
    return "";
  }
}
