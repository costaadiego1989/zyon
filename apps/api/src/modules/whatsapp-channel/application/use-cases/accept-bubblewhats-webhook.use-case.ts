import {
  BadRequestException, Inject, Injectable, ServiceUnavailableException, UnauthorizedException,
} from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  WHATSAPP_CONFIG_REPOSITORY, type WhatsAppChannelConfigEntity, type WhatsAppConfigRepository,
} from "../../domain/ports/whatsapp-config-repository.port.js";
import {
  WHATSAPP_WEBHOOK_INBOX, type WhatsAppInboxEvent, type WhatsAppWebhookInbox,
} from "../../domain/ports/whatsapp-webhook-inbox.port.js";
import type { IncomingMessageInput } from "./handle-incoming-message.use-case.js";

const digest = (value: string) => createHash("sha256").update(value).digest("hex");

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("webhook_payload_invalid");
  }
  return value as Record<string, unknown>;
}

function boundedString(value: unknown, max: number, required = true): string | undefined {
  if (value == null && !required) return undefined;
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) {
    throw new BadRequestException("webhook_payload_invalid");
  }
  return value;
}

@Injectable()
export class AcceptBubbleWhatsWebhookUseCase {
  constructor(
    @Inject(WHATSAPP_CONFIG_REPOSITORY) private readonly configRepo: WhatsAppConfigRepository,
    @Inject(WHATSAPP_WEBHOOK_INBOX) private readonly inbox: WhatsAppWebhookInbox,
  ) {}

  async message(secret: string | undefined, input: unknown): Promise<{ received: true }> {
    const body = record(input);
    const config = await this.authenticate(secret, body.deviceID);
    const eventId = boundedString(body.id, 500)!;
    const fromNumber = boundedString(body.fromNumber, 50)!;
    if (!/^\+?\d{8,15}(?:@s\.whatsapp\.net)?$/.test(fromNumber)) {
      throw new BadRequestException("webhook_sender_invalid");
    }
    if (typeof body.isGroup !== "boolean" || !Number.isSafeInteger(body.timestamp) || (body.timestamp as number) < 0) {
      throw new BadRequestException("webhook_payload_invalid");
    }
    const context = body.messageContext == null ? {} : record(body.messageContext);
    const key = context.key == null ? {} : record(context.key);
    if (key.fromMe !== undefined && typeof key.fromMe !== "boolean") {
      throw new BadRequestException("webhook_payload_invalid");
    }
    const payload = {
      merchantId: config.merchantId, deviceId: config.deviceId!,
      fromNumber, fromAlias: boundedString(body.fromAlias, 256, false),
      body: boundedString(body.body ?? body.caption ?? "", 16_000, false)!,
      messageType: boundedString(body.messageType, 64)!,
      mediaUrl: boundedString(body.url, 2048, false), mimetype: boundedString(body.mimetype, 128, false),
      timestamp: body.timestamp as number, provider: "BUBBLEWHATS",
      ignored: body.isGroup || key.fromMe === true,
    };
    const event = this.event(config, "message", eventId, fromNumber.replace(/\D/g, ""), payload);
    await this.persist([event]);
    return { received: true };
  }

  async status(secret: string | undefined, input: unknown): Promise<{ received: true }> {
    const body = record(input);
    const config = await this.authenticate(secret, body.deviceID);
    if (!Array.isArray(body.messages) || body.messages.length === 0 || body.messages.length > 100) {
      throw new BadRequestException("webhook_status_batch_invalid");
    }
    const events = body.messages.map((value) => {
      const message = record(value);
      const key = record(message.key);
      const update = record(message.update);
      const id = boundedString(key.id, 500)!;
      const remoteJid = boundedString(key.remoteJid, 100)!;
      if (typeof key.fromMe !== "boolean" || !Number.isSafeInteger(update.status)
        || (update.status as number) < 0 || (update.status as number) > 5) {
        throw new BadRequestException("webhook_status_invalid");
      }
      // One durable event per transition, independent of provider batch order/grouping.
      const eventId = JSON.stringify([id, remoteJid, key.fromMe, update.status]);
      const payload = {
        merchantId: config.merchantId, deviceId: config.deviceId!,
        messages: [{ key: { id, remoteJid, fromMe: key.fromMe }, update: { status: update.status as number } }],
      };
      return this.event(config, "status", eventId, `status:${remoteJid}:${id}`, payload);
    });
    await this.persist(events);
    return { received: true };
  }

  /**
   * Accepts a message only after the provider controller has authenticated its
   * request. Meta and Twilio use this same durable path as BubbleWhats, so a
   * successful HTTP acknowledgement always has a replay-safe inbox record.
   */
  async messageForAuthenticatedConfig(
    config: WhatsAppChannelConfigEntity,
    source: "TWILIO" | "META",
    eventId: string,
    input: Omit<IncomingMessageInput, "merchantId" | "deviceId" | "provider">,
  ): Promise<{ received: true }> {
    if (!config.enabled || (config.provider !== "TWILIO" && config.provider !== "META_CLOUD")) {
      throw new ServiceUnavailableException("whatsapp_channel_not_ready");
    }
    const provider = config.provider as "TWILIO" | "META_CLOUD";
    const stableEventId = boundedString(eventId, 500)!;
    const fromNumber = boundedString(input.fromNumber, 50)!;
    if (!/^\+?\d{8,15}$/.test(fromNumber)) {
      throw new BadRequestException("webhook_sender_invalid");
    }
    if (!Number.isSafeInteger(input.timestamp) || input.timestamp < 0) {
      throw new BadRequestException("webhook_payload_invalid");
    }
    const payload: IncomingMessageInput = {
      merchantId: config.merchantId,
      deviceId: config.deviceId ?? `${provider}:${config.id}`,
      fromNumber,
      fromAlias: boundedString(input.fromAlias, 256, false),
      body: boundedString(input.body, 16_000, false) ?? "",
      messageType: boundedString(input.messageType, 64)!,
      mediaUrl: boundedString(input.mediaUrl, 2048, false),
      mimetype: boundedString(input.mimetype, 128, false),
      timestamp: input.timestamp,
      provider,
    };
    const event: WhatsAppInboxEvent = {
      dedupKey: digest(JSON.stringify([source, config.merchantId, config.id, "message", stableEventId])),
      eventId: stableEventId,
      kind: "message",
      merchantId: config.merchantId,
      configId: config.id,
      deviceId: payload.deviceId,
      streamKey: digest(JSON.stringify([config.merchantId, config.id, "message", fromNumber.replace(/\D/g, "")])),
      payload,
      payloadHash: digest(JSON.stringify(payload)),
    };
    await this.persist([event]);
    return { received: true };
  }

  private async authenticate(secret: string | undefined, deviceValue: unknown): Promise<WhatsAppChannelConfigEntity> {
    const deviceId = boundedString(deviceValue, 256)!;
    const config = await this.configRepo.findByDeviceId(deviceId);
    if (!config || config.provider !== "BUBBLEWHATS" || config.deviceId !== deviceId) {
      throw new UnauthorizedException("webhook_secret_invalid");
    }
    if (!config.enabled || !config.webhookSecret?.trim()) {
      throw new ServiceUnavailableException("whatsapp_channel_not_ready");
    }
    if (typeof secret !== "string" || !secret
      || !timingSafeEqual(Buffer.from(digest(secret), "hex"), Buffer.from(digest(config.webhookSecret), "hex"))) {
      throw new UnauthorizedException("webhook_secret_invalid");
    }
    return config;
  }

  private event(
    config: WhatsAppChannelConfigEntity, kind: WhatsAppInboxEvent["kind"], eventId: string,
    stream: string, payload: WhatsAppInboxEvent["payload"],
  ): WhatsAppInboxEvent {
    return {
      dedupKey: digest(JSON.stringify(["BUBBLEWHATS", config.merchantId, config.id, kind, eventId])),
      eventId, kind, merchantId: config.merchantId, configId: config.id, deviceId: config.deviceId!,
      streamKey: digest(JSON.stringify([config.merchantId, config.id, kind, stream])),
      payload, payloadHash: digest(JSON.stringify(payload)),
    };
  }

  private async persist(events: WhatsAppInboxEvent[]): Promise<void> {
    try {
      await this.inbox.accept(events);
    } catch (error) {
      // Preserve ID/body collisions as 409, fail closed on all persistence failures.
      if (error instanceof Error && "getStatus" in error
        && typeof error.getStatus === "function" && error.getStatus() === 409) throw error;
      throw new ServiceUnavailableException("webhook_inbox_unavailable");
    }
  }
}
