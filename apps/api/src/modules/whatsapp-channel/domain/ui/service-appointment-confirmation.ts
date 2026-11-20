import { checkoutTone } from "../../../checkout/domain/services/checkout-collection-copy.js";

/** All facts come from the canonical server projection. financialText has
 * already passed its receipt/order/intent proof; this formatter decides no money. */
export interface ServiceAppointmentNotice {
  kind: "scheduled" | "attendance_receipt";
  merchantName: string; serviceName: string; professionalName: string; operationalStatus: string;
  startsAt: Date | string; endsAt: Date | string; timeZone: string;
  priceInCents: number; currency: string; financialText: string; tone?: unknown;
}
export interface ServiceAppointmentRegularization {
  kind: "regularization"; merchantName: string; paymentApproved: true; bookingConfirmed: boolean; tone?: unknown;
}
export type ServiceAppointmentConfirmation = ServiceAppointmentNotice | ServiceAppointmentRegularization;
const invalid = () => new Error("service_confirmation_invalid");
const clean = (value: unknown) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f*_~`]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160) : "";
const states: Record<string, string> = { pending: "Aguardando confirma\u00e7\u00e3o", scheduled: "Agendado", in_service: "Em atendimento",
  completed: "Conclu\u00eddo", no_show: "Aus\u00eancia registrada", cancelled: "Cancelado" };
const leads = { consultative: "Confira os detalhes do seu atendimento.", premium: "Confira os detalhes do seu atendimento com aten\u00e7\u00e3o.",
  direct: "Resumo do atendimento:", friendly: "Separei os detalhes para voc\u00ea conferir. \ud83d\ude0a", technical: "Resumo do agendamento e da situa\u00e7\u00e3o financeira." };
const complete = (blocks: string[]) => {
  const text = blocks.join("\n\n"); if (text.length > 4096) throw invalid(); return text;
};

/** Presentation only; no side effect, slot guarantee, provider call or asset. */
export function formatServiceAppointmentConfirmation(input: ServiceAppointmentConfirmation): string {
  if (!input || typeof input !== "object" || !clean(input.merchantName)) throw invalid();
  const merchant = `*${clean(input.merchantName)}*`, lead = leads[checkoutTone(input.tone)];
  if (input.kind === "regularization") {
    if (input.paymentApproved !== true || typeof input.bookingConfirmed !== "boolean") throw invalid();
    return complete([`\ud83e\udd16 \ud83d\udcac *${input.bookingConfirmed ? "Agendamento confirmado \u00b7 revis\u00e3o necess\u00e1ria" : "Agendamento em regulariza\u00e7\u00e3o"}*`, merchant, lead,
      input.bookingConfirmed ? "O pagamento foi aprovado e o agendamento est\u00e1 confirmado. A empresa precisa revisar a pend\u00eancia indicada."
        : "O pagamento foi aprovado. O agendamento precisa de regulariza\u00e7\u00e3o pela empresa; o hor\u00e1rio ainda n\u00e3o est\u00e1 confirmado.",
      "Fale com a equipe para conferir os pr\u00f3ximos passos."]);
  }
  if (!["scheduled", "attendance_receipt"].includes(input.kind) || !clean(input.serviceName) || !clean(input.professionalName)
    || !Object.hasOwn(states, input.operationalStatus) || input.kind === "scheduled" && input.operationalStatus !== "scheduled"
    || !(input.startsAt instanceof Date || typeof input.startsAt === "string") || !(input.endsAt instanceof Date || typeof input.endsAt === "string")
    || typeof input.timeZone !== "string" || !input.timeZone || !Number.isSafeInteger(input.priceInCents) || input.priceInCents < 0
    || typeof input.currency !== "string" || !/^[A-Z]{3}$/.test(input.currency) || typeof input.financialText !== "string" || !input.financialText.trim()
    || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(input.financialText)) throw invalid();
  const start = input.startsAt instanceof Date ? new Date(input.startsAt.getTime()) : new Date(input.startsAt);
  const end = input.endsAt instanceof Date ? new Date(input.endsAt.getTime()) : new Date(input.endsAt);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) throw invalid();
  let date: string, endDate: string, startTime: string, endTime: string, value: string;
  try {
    const dates = new Intl.DateTimeFormat("pt-BR", { timeZone: input.timeZone, day: "2-digit", month: "2-digit", year: "numeric" });
    const times = new Intl.DateTimeFormat("pt-BR", { timeZone: input.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    date = dates.format(start); endDate = dates.format(end); startTime = times.format(start); endTime = times.format(end);
    value = new Intl.NumberFormat("pt-BR", { style: "currency", currency: input.currency }).format(input.priceInCents / 100);
  } catch { throw invalid(); }
  const title = input.kind === "attendance_receipt" ? "Recebimento registrado no atendimento" : "Agendamento confirmado";
  return complete([`\ud83e\udd16 \u2705 *${title}*`, merchant, lead,
    `\ud83d\udccc *Servi\u00e7o:* ${clean(input.serviceName)}\n\ud83d\udc64 *Profissional:* ${clean(input.professionalName)}`,
    `\ud83d\udcc5 *Data:* ${date}\n\ud83d\udd52 *Hor\u00e1rio:* ${startTime} \u00e0s ${endTime}${endDate === date ? "" : ` (${endDate})`}\n\ud83c\udf10 *Fuso:* ${input.timeZone}`,
    ...(input.kind === "attendance_receipt" ? [`\ud83d\udccb *Situa\u00e7\u00e3o do atendimento:* ${states[input.operationalStatus]}`] : []),
    `\ud83d\udcb0 *Valor do servi\u00e7o:* ${value}`, `\ud83d\udcb3 *Pagamento*\n${input.financialText.trim()}`]);
}
