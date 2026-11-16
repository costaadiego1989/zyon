import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, Optional, ServiceUnavailableException } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import type { SupportMessageMetadata } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { lockSupportResource, persistSupportMessage } from "./support-persistence.js";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { TenantPrincipal } from "../../../shared/auth/tenant-principal.js";
import { admitWhatsAppEffectInTransaction } from "../../../shared/whatsapp/whatsapp-automation-context.js";
import { appendOutboxInTransaction } from "../../../shared/messaging/infrastructure/append-outbox-in-transaction.js";
import { PrismaWhatsAppHandoffRepository } from "../../whatsapp-channel/infrastructure/repositories/prisma-whatsapp-handoff.repository.js";
import { decodeWhatsAppCredentials } from "../../whatsapp-channel/infrastructure/repositories/whatsapp-credential-codec.js";
import { twilioAuthorityAccountId } from "../../whatsapp-channel/domain/services/connected-twilio-credentials.js";
import { whatsappE164 } from "../../whatsapp-channel/domain/services/whatsapp-phone.js";
import { authorizeWhatsAppOperator, WhatsAppOperatorAuthorizationError, type WhatsAppOperatorAuthority } from "../../whatsapp-channel/domain/services/whatsapp-operator-authorization.js";

const record=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};
export const WHATSAPP_SUPPORT_MESSAGE_REQUESTED="whatsapp.support.message.requested";
export const whatsappSupportDeliveryId=(messageId:string)=>"support_message:"+messageId;
export interface TicketMessageCommand { ticketId:string;merchantId:string;senderType:"buyer"|"merchant"|"system";
  content:string;metadata?:SupportMessageMetadata;clientMessageId?:string;operatorId?:string }
export interface TicketMessageServerContext { readonly principal:TenantPrincipal }

export interface TicketMessageDto {
  id: string; ticketId: string; senderType: "buyer" | "merchant" | "system";
  content: string; metadata?: SupportMessageMetadata | null; createdAt: string;
}
@Injectable()
export class SendTicketMessageUseCase {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Optional() private readonly handoffs?: PrismaWhatsAppHandoffRepository) {}
  async execute(input: TicketMessageCommand, context?:TicketMessageServerContext): Promise<TicketMessageDto> {
    if (typeof input.content !== "string" || !input.content.trim() || input.content.length > 4000) throw new BadRequestException("invalid_message");
    if (input.clientMessageId !== undefined && (typeof input.clientMessageId !== "string" || !/^[A-Za-z0-9_-]{8,100}$/.test(input.clientMessageId))) throw new BadRequestException("invalid_message_id");
    const direct=await this.prisma.supportTicket.findFirst({where:{id:input.ticketId,merchantId:input.merchantId}});
    if(!direct)throw new NotFoundException("ticket_not_found");
    if(direct.source==="whatsapp")return this.queueWhatsApp(input,context);
    const message = await this.prisma.$transaction(async tx => {
      await admitWhatsAppEffectInTransaction(tx,input.merchantId);
      let canonicalId = input.ticketId;
      const visited = new Set<string>();
      while (!visited.has(canonicalId)) {
        visited.add(canonicalId);
        const row = await tx.supportTicket.findFirst({ where: { id: canonicalId, merchantId: input.merchantId } });
        if (!row) throw new NotFoundException("ticket_not_found");
        if(row.source==="whatsapp")throw new ConflictException("whatsapp_ticket_alias_not_allowed");
        if (!row.mergedIntoId) break;
        canonicalId = row.mergedIntoId;
        if (visited.has(canonicalId)) throw new ConflictException("invalid_ticket_alias");
      }
      await lockSupportResource(tx, `support:${canonicalId}`);
      const ticket = await tx.supportTicket.findFirst({ where: { id: canonicalId, merchantId: input.merchantId } });
      if (!ticket) throw new NotFoundException("ticket_not_found");
      if(ticket.source==="whatsapp")throw new ConflictException("whatsapp_ticket_alias_not_allowed");
      if (input.clientMessageId) {
        const previous = await tx.supportTicketMessage.findFirst({ where: { ticketId: ticket.id, senderType: input.senderType, clientMessageId: input.clientMessageId } });
        if (previous) return previous;
      }
      if (["closed", "resolved"].includes(ticket.status)) throw new ConflictException("ticket_resolved");
      if (ticket.status === "open" && input.senderType === "merchant") {
        await tx.supportTicket.update({ where: { id: ticket.id }, data: { status: "in_progress", ...(input.operatorId ? { assignedTo: input.operatorId } : {}) } });
        await persistSupportMessage(tx, { ticketId: ticket.id, merchantId: ticket.merchantId, senderType: "system", content: "A loja iniciou seu atendimento.", metadata: { kind: "case_update", event: "started" } });
      }
      return persistSupportMessage(tx, { ...input, ticketId: ticket.id, content: input.content.trim(), metadata: input.metadata as any });
    });
    return { id: message.id, ticketId: message.ticketId, senderType: message.senderType as TicketMessageDto["senderType"], content: message.content, metadata: message.metadata as SupportMessageMetadata | null, createdAt: message.createdAt.toISOString() };
  }

  private async queueWhatsApp(input:TicketMessageCommand,context:TicketMessageServerContext|undefined):Promise<TicketMessageDto>{
    if(input.senderType!=="merchant"||!context||context.principal.kind!=="human")throw new ForbiddenException("human_operator_required");
    if(!input.clientMessageId)throw new BadRequestException("message_id_required");
    if(!this.handoffs)throw new ServiceUnavailableException("whatsapp_support_queue_unavailable");
    const candidate=await this.prisma.whatsAppHandoffBinding.findFirst({where:{merchantId:input.merchantId,ticketId:input.ticketId}});
    if(!candidate)throw new ConflictException("whatsapp_conversation_not_claimed");
    const scope={merchantId:input.merchantId,configId:candidate.configId,whatsappSessionId:candidate.whatsappSessionId};
    const content=input.content.trim(),clientMessageId=input.clientMessageId;
    const message=await this.handoffs.withReadLock(scope,async(tx,locked)=>{
      await admitWhatsAppEffectInTransaction(tx,input.merchantId);
      await lockSupportResource(tx,`support:${input.ticketId}`);
      const ticket=await tx.supportTicket.findFirst({where:{id:input.ticketId,merchantId:input.merchantId}});
      if(!ticket)throw new NotFoundException("ticket_not_found");
      let authority:Readonly<WhatsAppOperatorAuthority>;
      try{authority=authorizeWhatsAppOperator(scope,locked.binding,ticket,context.principal);}
      catch(error){
        if(error instanceof WhatsAppOperatorAuthorizationError){
          if(error.kind==="forbidden")throw new ForbiddenException(error.code);
          if(error.kind==="not_found")throw new NotFoundException(error.code);
          throw new ConflictException(error.code);
        }throw error;
      }
      const previous=await tx.supportTicketMessage.findFirst({where:{ticketId:ticket.id,senderType:"merchant",clientMessageId}});
      if(previous){
        const meta=record(previous.metadata),delivery=await tx.whatsAppDelivery.findUnique({where:{id:whatsappSupportDeliveryId(previous.id)}});
        const receipt=record(delivery?.response),original=record(receipt.authority);
        if(previous.content!==content||meta.kind!=="whatsapp_outgoing"||meta.clientMessageId!==clientMessageId||meta.operatorId!==authority.operatorId
          ||meta.bindingId!==authority.bindingId||meta.epoch!==authority.epoch||meta.configId!==scope.configId
          ||meta.whatsappSessionId!==scope.whatsappSessionId||!delivery||delivery.merchantId!==scope.merchantId||delivery.configId!==scope.configId
          ||receipt.purpose!=="support_message"||receipt.messageId!==previous.id||receipt.ticketId!==ticket.id||receipt.clientMessageId!==clientMessageId
          ||receipt.contentHash!==createHash("sha256").update(content).digest("hex")||original.merchantId!==scope.merchantId
          ||original.bindingId!==authority.bindingId||original.ticketId!==ticket.id||original.epoch!==authority.epoch
          ||original.configId!==scope.configId||original.whatsappSessionId!==scope.whatsappSessionId||original.operatorId!==authority.operatorId
          ||!isDeepStrictEqual(receipt.delivery,meta.delivery))throw new ConflictException("message_id_conflict");
        return previous;
      }
      const credentials=decodeWhatsAppCredentials(record(locked.config.credentials));
      const account=locked.config.provider==="META_CLOUD"?credentials.phoneNumberId:locked.config.provider==="TWILIO"
        ?twilioAuthorityAccountId({...locked.config,credentials}):locked.config.deviceId;
      const recipient=whatsappE164(locked.session.buyerPhone);
      if(typeof account!=="string"||!account.trim()||!recipient)throw new ServiceUnavailableException("whatsapp_channel_identity_unavailable");
      const delivery={status:"queued" as const,revision:0,providerMessageId:null};
      const metadata={kind:"whatsapp_outgoing",schemaVersion:1,
        bindingId:authority.bindingId,configId:scope.configId,whatsappSessionId:scope.whatsappSessionId,
        epoch:authority.epoch,operatorId:authority.operatorId,clientMessageId,delivery} satisfies Extract<SupportMessageMetadata,{kind:"whatsapp_outgoing"}>;
      const message=await persistSupportMessage(tx,{id:randomUUID(),merchantId:scope.merchantId,ticketId:ticket.id,senderType:"merchant",content,clientMessageId,metadata});
      const id=whatsappSupportDeliveryId(message.id);
      const outboxEventId=randomUUID();
      await tx.whatsAppDelivery.create({data:{id,merchantId:scope.merchantId,configId:scope.configId,deviceId:locked.session.deviceId,
        state:"queued",processingToken:"not_started",response:{purpose:"support_message",schemaVersion:1,outboxEventId,messageId:message.id,ticketId:ticket.id,
          clientMessageId,contentHash:createHash("sha256").update(content).digest("hex"),
          authority:{...authority,deviceId:locked.session.deviceId,provider:locked.config.provider,recipient,accountId:account},delivery}}});
      await appendOutboxInTransaction(tx,{event_id:outboxEventId,event_type:WHATSAPP_SUPPORT_MESSAGE_REQUESTED,schema_version:1,
        merchant_id:scope.merchantId,occurred_at:message.createdAt.toISOString(),correlation_id:id,causation_id:message.id,producer:"support",
        payload:{messageId:message.id,ticketId:ticket.id,bindingId:authority.bindingId,epoch:authority.epoch}});
      return message;
    });
    return{id:message.id,ticketId:message.ticketId,senderType:"merchant",content:message.content,
      metadata:message.metadata as SupportMessageMetadata|null,createdAt:message.createdAt.toISOString()};
  }
}
