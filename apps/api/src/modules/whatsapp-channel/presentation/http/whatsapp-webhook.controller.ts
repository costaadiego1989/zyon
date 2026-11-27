/**
 * WhatsApp Webhook Controller
 *
 * Receives messages from Meta Cloud API and legacy providers, then dispatches to the message pipeline.
 * No auth guard — authenticates via webhook secret header or provider HMAC signature.
 * BubbleWhats acknowledges only after durable inbox persistence.
 */

import {
  Body,
  ConflictException,
  BadRequestException,
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
  Optional,
} from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { createHmac, timingSafeEqual } from "node:crypto";
import { MARKETING_RELATIONSHIP, MARKETING_ACCEPT, MARKETING_DECLINE, type MarketingRelationshipPort } from "../../../../shared/contracts/marketing.js";
import type { Request, Response } from "express";
import { WHATSAPP_CONFIG_REPOSITORY, type WhatsAppConfigRepository } from "../../domain/ports/whatsapp-config-repository.port.js";
import { AcceptBubbleWhatsWebhookUseCase } from "../../application/use-cases/accept-bubblewhats-webhook.use-case.js";
import { HandleStatusUpdateUseCase } from "../../application/use-cases/handle-status-update.use-case.js";
import { validateTwilioSignature } from "../../domain/services/twilio-signature-validator.js";
import { parseTwilioInbound } from "../../domain/services/twilio-inbound.js";
import { twilioWhatsAppCallbackUrl, twilioOperatorStatusRequestUrl } from "../../domain/services/public-url.js";
import { FISCAL_DELIVERY_DISPATCH, type FiscalDeliveryDispatchPort, type MetaDeliveryStatus } from "../../../../shared/integrations/fiscal-delivery-dispatch.port.js";

import {PROSPECT_META_DISPATCH,type ProspectMetaDispatchPort} from "../../../../shared/integrations/prospect-meta-dispatch.port.js";
import { readTwilioReceiptForm, parseTwilioOperatorReceipt } from "../../domain/services/whatsapp-operator-receipt.js";
import { WhatsAppSupportDeliveryService } from "../../application/services/whatsapp-support-delivery.service.js";
import { SupportCaseAlertDeliveryService } from "../../../support/application/services/support-case-alert-delivery.service.js";

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

import { WhatsAppDeliveryService } from "../../application/services/whatsapp-delivery.service.js";

interface MetaInboundMessage {
  referral?: { source_id?: string; source_type?: string };
  id?: string;
  from?: string;
  from_user_id?: string;
  timestamp?: string;
  type?: string;
  text?: { body?: string };
  order?: import("../../infrastructure/adapters/meta-catalog-order.adapter.js").MetaCatalogOrder;
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
  audio?: { id?: string; mime_type?: string };
  button?: { text?: string; payload?: string };
  interactive?: { button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string }; nfm_reply?: { response_json?: string; body?: string } };
}

interface MetaWebhookPayload {
  entry?: Array<{
    id?: string;
    changes?: Array<{
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        contacts?: Array<{wa_id?:string;user_id?:string; profile?: { name?: string } }>;
        messages?: MetaInboundMessage[];
        statuses?: Array<MetaDeliveryStatus & { timestamp?: string; biz_opaque_callback_data?: string; errors?: Array<{ code?: number }> }>;
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
    @Optional() private readonly delivery?: WhatsAppDeliveryService,
    @Optional() private readonly metaStatus?: HandleStatusUpdateUseCase,
    @Optional() @Inject(FISCAL_DELIVERY_DISPATCH) private readonly fiscalDelivery?: FiscalDeliveryDispatchPort,
    @Optional() @Inject(PROSPECT_META_DISPATCH) private readonly prospecting?: ProspectMetaDispatchPort,
    @Optional() @Inject(MARKETING_RELATIONSHIP) private readonly marketing?: MarketingRelationshipPort,
    @Optional() private readonly supportDelivery?: WhatsAppSupportDeliveryService,
    @Optional() private readonly staffAlertDelivery?: SupportCaseAlertDeliveryService,
  ) {}

  @Get("meta")
  verifyMetaWebhook(
    @Query() query: Record<string, string | undefined>,
    @Res() response: Response,
  ): void {
    this.challenge(query,response,process.env.META_WEBHOOK_VERIFY_TOKEN);
  }
  @Get("meta-platform")
  verifyPlatformMeta(@Query() query:Record<string,string|undefined>,@Res() response:Response){
    this.challenge(query,response,process.env.PROSPECTING_META_WEBHOOK_VERIFY_TOKEN);
  }
  private challenge(query:Record<string,string|undefined>,response:Response,verifyToken:string|undefined){
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
    return this.receiveSignedMeta(signature,payload,request,false);
  }
  @Post("meta-platform")
  @HttpCode(200)
  receivePlatformMeta(@Headers("x-hub-signature-256") signature:string|undefined,@Body() payload:MetaWebhookPayload,@Req() request:Request){
    return this.receiveSignedMeta(signature,payload,request,true);
  }
  private async receiveSignedMeta(signature:string|undefined,payload:MetaWebhookPayload,request:Request,dedicated:boolean):Promise<{received:true}>{
    const rawBody = (request as Request & { rawBody?: Buffer }).rawBody;
    if (!this.isValidMetaSignature(signature, rawBody,dedicated?process.env.PROSPECTING_META_APP_SECRET:process.env.META_APP_SECRET)) {
      throw new UnauthorizedException("invalid_meta_signature");
    }

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;

        const phoneNumberId = change.value?.metadata?.phone_number_id;
        if (!phoneNumberId) continue;

        let value=change.value,sharedRemainder=false;
        if(this.prospecting){
          try{
            const handled=await this.prospecting.accept({appId:dedicated?process.env.PROSPECTING_META_APP_ID:process.env.META_EMBEDDED_SIGNUP_APP_ID??process.env.META_APP_ID,wabaId:entry.id,phoneNumberId,value:change.value!});
            if(handled===true)continue;
            if(handled){sharedRemainder=true;value={...change.value,messages:change.value?.messages?.filter(m=>handled.remainingValue.messages?.includes(m)),statuses:change.value?.statuses?.filter(s=>handled.remainingValue.statuses?.includes(s))};}
          }catch(error){
            if(error instanceof Error&&error.message==="inbox_replay_conflict")throw new ConflictException(error.message);
            throw new ServiceUnavailableException("prospect_webhook_pending");
          }
        }
        if(!sharedRemainder&&(dedicated||phoneNumberId===process.env.PROSPECTING_META_PHONE_NUMBER_ID&&!process.env.PROSPECTING_META_SYSTEM_USER_ACCESS_TOKEN))throw new ServiceUnavailableException("prospect_webhook_binding_unavailable");

        if (value?.statuses?.length) {
          if (!this.fiscalDelivery) throw new ServiceUnavailableException("fiscal_delivery_dispatch_unavailable");
          try { await this.fiscalDelivery.fromMeta(phoneNumberId, value.statuses); }
          catch { throw new ServiceUnavailableException("fiscal_delivery_callback_pending"); }
        }

        const config = await this.configRepo.findByMetaPhoneNumberId(phoneNumberId);
        if (!config || config.provider !== "META_CLOUD") continue;
        for (const status of value?.statuses ?? []) {
          if (!this.delivery) throw new ServiceUnavailableException("whatsapp_delivery_not_configured");
          await this.delivery.reconcileMeta(config.merchantId, config.id, status);
          if (status.id && ["sent","delivered","read","failed"].includes(status.status ?? ""))
            await this.marketing?.delivery(config.merchantId, status.id, status.status === "sent" ? "accepted" : status.status as "delivered"|"read"|"failed");
          if (this.supportDelivery) await this.supportDelivery.reconcileMeta(config, phoneNumberId, status);
          else if (status.biz_opaque_callback_data?.startsWith("support_message:")) throw new ServiceUnavailableException("whatsapp_support_receipts_not_configured");
          if (this.staffAlertDelivery) await this.staffAlertDelivery.reconcileMeta(config, phoneNumberId, status);
          else if (status.biz_opaque_callback_data?.startsWith("support_case_alert:")) throw new ServiceUnavailableException("whatsapp_staff_alert_receipts_not_configured");
        }
        for (const status of value?.statuses ?? []) {
          if (!status.id || !status.status) continue;
          if (!this.metaStatus) throw new ServiceUnavailableException("whatsapp_receipt_store_unavailable");
          await this.metaStatus.receiveMetaReceipt({ merchantId: config.merchantId, configId: config.id, providerAccountId: phoneNumberId, messageId: status.id,
            status: status.status, timestamp: status.timestamp, correlationId: status.biz_opaque_callback_data,
            errorCode: status.errors?.find(error => Number.isSafeInteger(error.code))?.code });
        }
        if (!config.enabled) continue;

        for (const message of value?.messages ?? []) {
          if (!message.id || !message.from) continue;

          const body = this.metaMessageBody(message);
          if (!body) {
            continue;
          }
          const contacts=value?.contacts??[];
          const senderName=(contacts.find(c=>c.wa_id&&c.wa_id.replace(/^\+/,"")===message.from!.replace(/^\+/,"")||c.user_id&&c.user_id===message.from_user_id)??(contacts.length===1?contacts[0]:undefined))?.profile?.name;

          await this.acceptBubbleWhats.messageForAuthenticatedConfig(config, "META", message.id, {
            fromNumber: message.from.startsWith("+") ? message.from : `+${message.from}`,
            fromAlias: senderName,
            body,
            ...(message.order ? { catalogOrder: message.order } : {}),
            ...((message.image?.id ?? message.document?.id ?? message.audio?.id) ? { metaMedia: {
              id: (message.image?.id ?? message.document?.id ?? message.audio?.id)!, mimeType: message.image?.mime_type ?? message.document?.mime_type ?? message.audio?.mime_type,
              name: message.document?.filename,
            } } : {}),
            ...((message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id) ? { interactiveId: message.interactive?.button_reply?.id ?? message.interactive?.list_reply?.id } : {}),
            ...(message.interactive?.nfm_reply?.response_json ? { flowResponse: this.metaFlowResponse(message.interactive.nfm_reply.response_json) } : {}),
            messageType: message.type ?? "text",
            timestamp: Number(message.timestamp ?? 0) * 1000 || Date.now(),
            ...(message.referral?.source_type === "ad" && /^\d{1,40}$/.test(message.referral.source_id ?? "") ? { adReferral: { adId: message.referral.source_id! } } : {}),
            providerTimestampVerified: typeof message.timestamp === "string" && /^\d{10}$/.test(message.timestamp) && Number(message.timestamp) * 1000 <= Date.now() + 60_000,
          }, { provider: "META_CLOUD", accountId: phoneNumberId });
        }
      }
    }

    return { received: true };
  }

  private isValidMetaSignature(signature: string | undefined, rawBody: Buffer | undefined,secret:string|undefined): boolean {
    if (!signature || !rawBody || !secret) return false;

    const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    const received = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return received.length === expectedBuffer.length && timingSafeEqual(received, expectedBuffer);
  }

  private metaMessageBody(message: MetaInboundMessage): string {
    const choice = message.interactive?.button_reply?.id ?? message.button?.payload;
    if (choice === MARKETING_ACCEPT || choice === MARKETING_DECLINE) return choice;
    return message.text?.body
      ?? (message.order ? "Escolhi produtos no catálogo do WhatsApp" : undefined)
      ?? message.image?.caption ?? message.document?.caption
      ?? ((message.image || message.document || message.audio) ? "Enviei um anexo para ajudar na compra" : undefined)
      ?? message.button?.text
      ?? message.interactive?.button_reply?.title
      ?? message.interactive?.list_reply?.title
      ?? (message.interactive?.nfm_reply ? "Dados do formulário" : undefined)
      ?? "";
  }

  private metaFlowResponse(raw: string): Record<string, unknown> {
    if (raw.length > 4096) throw new BadRequestException("whatsapp_flow_response_invalid");
    try { const reply = JSON.parse(raw); if (reply && typeof reply === "object" && !Array.isArray(reply)) return reply; } catch {}
    throw new BadRequestException("whatsapp_flow_response_invalid");
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
   * Operator status callbacks authenticate the exact encoded public URL and
   * complete form before resolving an immutable historical command.
   */
  @Post("twilio/status")
  @HttpCode(200)
  async receiveTwilioStatus(
    @Headers("x-twilio-signature") signature: string | undefined,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<string> {
    if (!req.is("application/x-www-form-urlencoded")) throw new BadRequestException("twilio_status_form_required");
    const form = readTwilioReceiptForm(body);
    if (!form) throw new BadRequestException("invalid_twilio_status_form");
    const requestUrl = twilioOperatorStatusRequestUrl(req.originalUrl);
    if (!requestUrl) throw new ServiceUnavailableException("twilio_status_url_not_configured");
    const query = new URL(requestUrl).searchParams, entries = [...query.entries()];
    const configId = query.get("configId"), correlationId = query.get("correlationId");
    if (entries.length !== 2 || query.getAll("configId").length !== 1 || query.getAll("correlationId").length !== 1
      || !configId || configId.length > 1024 || configId.trim() !== configId || /[\u0000-\u001f\u007f]/.test(configId)
      || !correlationId || correlationId.length > 1024 || !(correlationId.startsWith("support_message:") && correlationId.length > "support_message:".length
        || /^support_case_alert:[a-f0-9]{64}$/.test(correlationId)) || /[\s\u0000-\u001f\u007f]/.test(correlationId))
      throw new BadRequestException("invalid_twilio_status_scope");
    const config = await this.configRepo.findById(configId);
    if (!config || config.provider !== "TWILIO") throw new UnauthorizedException("invalid_twilio_account");
    const authToken = config.credentials.authToken;
    if (typeof authToken !== "string" || !authToken.trim()) throw new ServiceUnavailableException("twilio_webhook_auth_not_configured");
    if (typeof signature !== "string" || !validateTwilioSignature(signature, requestUrl, form, authToken))
      throw new UnauthorizedException("invalid_twilio_signature");
    const receipt = parseTwilioOperatorReceipt(form);
    if (!receipt) throw new BadRequestException("invalid_twilio_status");
    if (receipt.providerAccountId !== config.credentials.accountSid) throw new UnauthorizedException("invalid_twilio_account");
    if (correlationId.startsWith("support_case_alert:")) {
      if (!this.staffAlertDelivery) throw new ServiceUnavailableException("whatsapp_staff_alert_receipts_not_configured");
      await this.staffAlertDelivery.reconcile(config, { ...receipt, correlationId });
    } else {
      if (!this.supportDelivery) throw new ServiceUnavailableException("whatsapp_support_receipts_not_configured");
      await this.supportDelivery.reconcile(config, { ...receipt, correlationId });
    }
    return "";
  }

  /** Legacy inbound message parsing stays separate from status receipts. */
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
    }, ...(typeof body.AccountSid === "string" && body.AccountSid === config.credentials.accountSid
      ? [{ provider: "TWILIO", accountId: body.AccountSid, sender: normalized.toNumber }] as const : [] as const));
    return "";
  }
}
