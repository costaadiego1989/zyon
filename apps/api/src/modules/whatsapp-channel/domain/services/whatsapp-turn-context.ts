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

/** Filled by the authenticated inbox pipeline, never model or HTTP arguments. */
@Injectable()
export class WhatsAppTurnContext {
  private readonly storage = new AsyncLocalStorage<{ turn: Readonly<VerifiedWhatsAppTurn> }>();
  current(): Readonly<VerifiedWhatsAppTurn> | undefined { return this.storage.getStore()?.turn; }
  run<T>(turn: VerifiedWhatsAppTurn, work: () => T): T {
    return this.storage.run({ turn: Object.freeze({ ...turn, scope: Object.freeze({ ...turn.scope }) }) }, work);
  }
  withMessage<T>(message: string, origin: VerifiedWhatsAppTurn["origin"], work: () => T): T {
    const turn = this.current();
    if (!turn) throw new Error("whatsapp_turn_context_required");
    return this.run({ ...turn, message, origin }, work);
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
