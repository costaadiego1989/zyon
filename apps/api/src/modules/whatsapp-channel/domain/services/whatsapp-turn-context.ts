import { Injectable } from "@nestjs/common";
import { AsyncLocalStorage } from "node:async_hooks";
import type { HandoffScope } from "./whatsapp-handoff-state.js";

export interface VerifiedWhatsAppTurn {
  scope: HandoffScope;
  inboxId: string;
  leaseToken: string;
  conversationId: string;
  message: string;
  origin: "text" | "button" | "voice";
}

export interface ConfirmedWhatsAppHandoffNotice {
  confirmed: true; reply: string; ticketId: string; bindingId: string; epoch: number;
}

/** Filled by the authenticated inbox pipeline, never model or HTTP arguments. */
@Injectable()
export class WhatsAppTurnContext {
  private readonly storage = new AsyncLocalStorage<{ turn: Readonly<VerifiedWhatsAppTurn>; notice?: Readonly<ConfirmedWhatsAppHandoffNotice>; denial?: Readonly<{confirmed:false;reply:string}>; noticeTaken?: boolean }>();
  current(): Readonly<VerifiedWhatsAppTurn> | undefined { return this.storage.getStore()?.turn; }
  run<T>(turn: VerifiedWhatsAppTurn, work: () => T): T {
    return this.storage.run({ turn: Object.freeze({ ...turn, scope: Object.freeze({ ...turn.scope }) }) }, work);
  }
  withMessage<T>(message: string, origin: VerifiedWhatsAppTurn["origin"], work: () => T): T {
    const turn = this.current();
    if (!turn) throw new Error("whatsapp_turn_context_required");
    return this.run({ ...turn, message, origin }, work);
  }
  /** Only the canonical handoff service supplies its actual SQL result. This
   * remembered reply is not send authority; the existing notice fence still
   * verifies original inbox/case/epoch/config/window at request initiation. */
  confirmHandoff(value: Omit<ConfirmedWhatsAppHandoffNotice, "confirmed">): void {
    const store=this.storage.getStore();if(!store)throw Error("whatsapp_turn_context_required");
    if(![value.ticketId,value.bindingId].every(id=>typeof id==="string"&&id.trim()===id&&id.length>0&&id.length<=191)
      ||typeof value.reply!=="string"||!value.reply.trim()||value.reply.length>7900
      ||!Number.isSafeInteger(value.epoch)||value.epoch<1||value.epoch>2_147_483_647)throw Error("whatsapp_handoff_notice_invalid");
    const notice=Object.freeze({confirmed:true as const,reply:value.reply,ticketId:value.ticketId,bindingId:value.bindingId,epoch:value.epoch});
    if(store.notice&&JSON.stringify(store.notice)!==JSON.stringify(notice))throw Error("whatsapp_handoff_notice_changed");
    if(!store.notice)store.notice=notice;
  }
  rejectHandoff(intent: "clarify" | "not_requested"): void {
    const store=this.storage.getStore();if(!store)throw Error("whatsapp_turn_context_required");
    if(store.notice||store.noticeTaken)return;
    store.denial=Object.freeze({confirmed:false as const,reply:intent==="clarify"
      ? "🤖 *Atendimento humano*\n\nVocê quer falar com um atendente da equipe da loja?"
      : "🤖 *Conversa mantida*\n\nSeu atendimento continua por aqui. Não abri um chamado para a equipe."});
  }
  takeHandoffNotice(): Readonly<ConfirmedWhatsAppHandoffNotice | {confirmed:false;reply:string}> | undefined {
    const store=this.storage.getStore();if(!store||!store.notice&&!store.denial||store.noticeTaken)return;
    store.noticeTaken=true;return store.notice??store.denial;
  }
  /** Called only after the media adapter's typed result and exact turn scope. */
  authorizeSpeech(message: string): void {
    const store = this.storage.getStore();
    if (!store) throw new Error("whatsapp_turn_context_required");
    store.turn = Object.freeze({ ...store.turn, message, origin: "voice" });
  }
}

export function isHumanSupportRequest(value: string): boolean {
  const text = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/[.!?]+$/, "").trim();
  if (/^\/(?:atendente|humano)$/.test(text) || /^(?:atendimento|suporte) humano$/.test(text)) return true;
  return /^(?:(?:eu )?(?:quero|gostaria de|preciso|posso|poderia) )?falar com (?:um |uma |o |a )?(?:atendente|pessoa|humano|suporte(?: humano)?|equipe(?: da loja)?)$/.test(text)
    || /^(?:quero|preciso de|gostaria de) (?:um |uma |o |a )?(?:atendente|pessoa|atendimento humano|suporte humano)$/.test(text);
}
