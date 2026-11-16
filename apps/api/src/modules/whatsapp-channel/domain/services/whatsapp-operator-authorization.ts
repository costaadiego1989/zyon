import type { TenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import type { HandoffScope, HandoffState } from "./whatsapp-handoff-state.js";
export class WhatsAppOperatorAuthorizationError extends Error {
 constructor(public readonly kind:"forbidden"|"not_found"|"conflict",public readonly code:string){super(code);}
}
export interface WhatsAppOperatorTicket {id:string;merchantId:string;sessionId:string|null;source:string;status:string;mergedIntoId:string|null;assignedTo:string|null}
export interface WhatsAppOperatorAuthority extends HandoffScope {bindingId:string;ticketId:string;epoch:number;operatorId:string}
/** Caller reads these canonical facts while retaining identity/session and
 * support locks; no payload, alias or buyer-wide fallback grants this proof. */
export function authorizeWhatsAppOperator(scope:HandoffScope,binding:Readonly<HandoffState>|null,ticket:WhatsAppOperatorTicket,
 principal:TenantPrincipal|undefined):Readonly<WhatsAppOperatorAuthority>{
 if(!principal||principal.kind!=="human"||!["owner","admin","staff"].includes(principal.role))throw new WhatsAppOperatorAuthorizationError("forbidden","human_operator_required");
 if(principal.tenantId!==scope.merchantId)throw new WhatsAppOperatorAuthorizationError("forbidden","operator_scope_forbidden");
 if(!binding||binding.merchantId!==scope.merchantId||binding.configId!==scope.configId||binding.whatsappSessionId!==scope.whatsappSessionId
  ||binding.ticketId!==ticket.id||ticket.merchantId!==scope.merchantId||ticket.sessionId!==scope.whatsappSessionId||ticket.source!=="whatsapp"||ticket.mergedIntoId!==null)
  throw new WhatsAppOperatorAuthorizationError("not_found","whatsapp_case_not_found");
 if(binding.mode!=="human"||ticket.status!=="in_progress"||!Number.isSafeInteger(binding.epoch)||binding.epoch<1)
  throw new WhatsAppOperatorAuthorizationError("conflict","whatsapp_conversation_not_claimed");
 if(binding.assignedOperatorId!==principal.userId||ticket.assignedTo!==principal.userId)
  throw new WhatsAppOperatorAuthorizationError("forbidden","whatsapp_claim_owned_by_another_operator");
 return Object.freeze({...scope,bindingId:binding.id,ticketId:ticket.id,epoch:binding.epoch,operatorId:principal.userId});
}
