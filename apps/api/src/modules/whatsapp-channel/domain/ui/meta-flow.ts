import { timingSafeEqual } from "node:crypto";
import type { WhatsAppConversationState } from "./meta-ui.types.js";

export const META_FIELD_FLOW_NAMES = { registration: "zyon_registration_v1", address: "zyon_address_v1" } as const;
export const META_FIELD_LABELS = { fullName: "Nome completo", email: "Email", cpf: "CPF", zip: "CEP", number: "Número do endereço", complement: "Complemento" } as const;

/** No remote data endpoint, hidden verification flags or payment inputs. */
export function metaFieldFlowJson(address: boolean) {
  return { version: "3.1", screens: [{ id: "DETAILS", title: address ? "Entrega do pedido" : "Dados do pedido", terminal: true,
    data: { label: { type: "string", __example__: "Nome completo" } },
    layout: { type: "SingleColumnLayout", children: [{ type: "Form", name: "form", children: [
      { type: "TextCaption", text: "Preencha o dado solicitado para continuar sua compra." },
      { type: "TextInput", name: "value", label: "${data.label}", "input-type": "text", required: true },
      { type: "Footer", label: "Continuar", "on-click-action": { name: "complete", payload: { value: "${form.value}" } } },
    ] }] } }] };
}

/** Called only with a signed Meta webhook, already routed by merchant and wa_id. */
export function resolveMetaFieldFlow(state: WhatsAppConversationState, reply: Record<string, unknown>, now = Date.now()): string | undefined {
  const pending = state.pendingFlow;
  if (!pending || pending.expiresAt < now || pending.checkoutSessionId !== state.checkoutSessionId || state.stage !== "checkout") return undefined;
  if (typeof reply.flow_token !== "string" || typeof reply.value !== "string" || reply.value.length > 160 || !reply.value.trim()) return undefined;
  const received = Buffer.from(reply.flow_token), expected = Buffer.from(pending.token);
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return undefined;
  const input = reply.value.trim().replace(/[\r\n]/g, " ");
  if (pending.field === "email" && !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(input)) return undefined;
  if (pending.field === "cpf" && input.replace(/\D/g, "").length !== 11) return undefined;
  if (pending.field === "zip" && input.replace(/\D/g, "").length !== 8) return undefined;
  if (pending.field === "number" && !/^(?:[\dA-Za-z /-]{1,30}|S\/N)$/i.test(input)) return undefined;
  if (pending.field === "fullName") return `Meu nome completo é ${input}`;
  if (pending.field === "cpf") return `CPF: ${input}`;
  if (pending.field === "zip") return `CEP: ${input}`;
  // The shared checkout validates/normalizes the value and still performs OTP.
  return input;
}
