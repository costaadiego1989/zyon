import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { professionalSlotId } from "../../../../shared/bookings/service-checkout-selection.js";
import { serviceBookingResultSchema, canonicalServiceSelectionSchema } from "../../../storefront/domain/contracts/service-booking-tool.schemas.js";
import type { VerifiedWhatsAppTurn } from "../services/whatsapp-turn-context.js";
import type { MetaUiChoice, MetaUiMessage, MetaUiPresentation, MetaUiView, StoreUiAction, WhatsAppConversationState } from "./meta-ui.types.js";

import { nativeServicePreparedSummarySchema, nativeServiceConfirmedSchema } from "./native-service-prepared-summary.js";

const id = z.string().min(1).max(191).refine(value => value.trim() === value && !/[\x00-\x1f\x7f]/.test(value));
const version = z.number().int().positive().max(2_147_483_647);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => { const parsed = new Date(value + "T12:00:00Z"); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value; });
const offerSchema = z.strictObject({ productId: id, variantId: id, name: z.string().min(1).max(500).refine(value => value.trim().length > 0), description: z.string().max(200).optional() });
const personSchema = z.strictObject({ id, name: z.string().min(1).max(500), version });
const bindingSchema = z.strictObject({ merchantId: id, configId: id, whatsappSessionId: id, conversationId: id,
  // A UI freshness limit supplied by the existing server authority, never a token.
  validUntil: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) });
const modelSchema = z.discriminatedUnion("step", [
  z.strictObject({ step: z.literal("prepared"), offer: offerSchema, source: nativeServicePreparedSummarySchema, notice: z.literal("button_required").optional() }),
  nativeServiceConfirmedSchema,
  z.strictObject({ step: z.literal("services"), offers: z.array(offerSchema).max(100), hasMore: z.boolean() }),
  z.strictObject({ step: z.literal("professionals"), offer: offerSchema, source: serviceBookingResultSchema }),
  z.strictObject({ step: z.literal("dates"), offer: offerSchema, professional: personSchema, source: serviceBookingResultSchema }),
  z.strictObject({ step: z.literal("slots"), offer: offerSchema, professional: personSchema, date, policyVersion: version, source: serviceBookingResultSchema }),
  z.strictObject({ step: z.literal("review"), offer: offerSchema, source: serviceBookingResultSchema, notice: z.literal("button_required").optional() }),
  z.strictObject({ step: z.literal("status"), reason: z.enum(["read_failed", "stale", "expired"]) }),
]);
const stateSchema = z.strictObject({ binding: bindingSchema, model: modelSchema });
export type NativeServiceBookingControls = z.infer<typeof stateSchema>;
const common = { kind: z.literal("service_booking"), uiRevision: id.optional() };
const offerIds = { productId: id, variantId: id };
const personIds = { ...offerIds, professionalId: id, professionalVersion: version };
export const nativeServiceBookingActionSchema = z.discriminatedUnion("operation", [
  z.strictObject({ ...common, operation: z.literal("offer"), ...offerIds }),
  z.strictObject({ ...common, operation: z.literal("professional"), ...personIds }),
  z.strictObject({ ...common, operation: z.literal("date"), ...personIds, policyVersion: version, date }),
  z.strictObject({ ...common, operation: z.literal("slot"), selection: canonicalServiceSelectionSchema.strict() }),
  z.strictObject({ ...common, operation: z.literal("continue"), selection: canonicalServiceSelectionSchema.strict() }),
  z.strictObject({ ...common, operation: z.literal("back"), target: z.enum(["services", "professionals", "dates", "slots"]) }),
  z.strictObject({ ...common, operation: z.literal("page"), page: z.number().int().min(0).max(1000) }),
  z.strictObject({ ...common, operation: z.literal("confirm") }),
  z.strictObject({ ...common, operation: z.literal("refine") }),
]);
export type NativeServiceBookingAction = z.infer<typeof nativeServiceBookingActionSchema>;
type Offer = z.infer<typeof offerSchema>;
type Selection = z.infer<typeof canonicalServiceSelectionSchema>;
const PAGE_SIZE = 5;
const dateLabel = (value: string) => value.slice(8, 10) + "/" + value.slice(5, 7) + "/" + value.slice(0, 4);
const clip = (value: string, max: number) => Array.from(value).slice(0, max).join("");
const zoneLabel = (zone: string) => zone === "America/Sao_Paulo" ? "Horário de Brasília" : "Fuso do atendimento: " + zone;
const hour = (selection: Selection) => new Intl.DateTimeFormat("pt-BR", { timeZone: selection.timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(selection.startsAt));
const amount = (selection: Selection) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: selection.currency }).format(selection.priceInCents / 100);
const control = (label: string, action: NativeServiceBookingAction, description?: string): MetaUiChoice => ({ label, action, ...(description ? { description } : {}) });
const navigation = (): MetaUiChoice[] => [{ label: "Menu principal", action: { kind: "menu" } }, { label: "Falar com atendente", action: { kind: "message", message: "Falar com atendente" } }];
const offerIdentity = (offer: Offer) => ({ productId: offer.productId, variantId: offer.variantId });

function coherent(state: NativeServiceBookingControls): boolean {
  const { model, binding } = state;
  if (model.step === "services") return new Set(model.offers.map(value => JSON.stringify(offerIdentity(value)))).size === model.offers.length;
  if (model.step === "status") return true;
  if (model.step === "confirmed") return new Set(model.appointments.map(value => value.id)).size === model.appointments.length;
  if (model.step === "prepared") return model.source.selections.every(value => professionalSlotId(binding.merchantId, value) === value.slotId
    && value.policyVersion === model.source.policy_version) && (!model.source.requires_hold || model.source.service_slot_hold !== null);
  const source = model.source;
  if (Object.hasOwn(source, "error") || source.kind !== ({ professionals: "professionals", dates: "dates", slots: "slots", review: "selection" } as const)[model.step]) return false;
  if (model.step === "professionals" && source.kind === "professionals") return source.professionals.every(value => value.name.trim().length > 0)
    && new Set(source.professionals.map(value => value.id)).size === source.professionals.length;
  if (model.step === "dates" && source.kind === "dates") return source.professional_version === model.professional.version && new Set(source.dates).size === source.dates.length;
  const selections = model.step === "slots" && source.kind === "slots" ? source.selections : model.step === "review" && source.kind === "selection" ? [source.selection] : [];
  if (new Set(selections.map(value => value.slotId)).size !== selections.length) return false;
  for (const selection of selections) {
    if (selection.productId !== model.offer.productId || selection.variantId !== model.offer.variantId
      || professionalSlotId(binding.merchantId, selection) !== selection.slotId || Date.parse(selection.endsAt) - Date.parse(selection.startsAt) !== selection.durationMinutes * 60_000) return false;
    try { hour(selection); amount(selection); } catch { return false; }
    if (model.step === "slots" && (selection.professionalId !== model.professional.id || selection.professionalVersion !== model.professional.version
      || selection.policyVersion !== model.policyVersion || selection.date !== model.date)) return false;
    if (model.step === "review" && source.kind === "selection" && selection.policyVersion !== source.policy.version) return false;
  }
  return true;
}
function safeState(value: unknown): NativeServiceBookingControls | undefined {
  const model = value && typeof value === "object" && "model" in value ? value.model : undefined;
  const source = model && typeof model === "object" && "source" in model ? model.source : undefined;
  if (source && typeof source === "object" && (Object.hasOwn(source, "error") || ("ok" in source && source.ok === false) || ("success" in source && source.success === false))) return;
  const parsed = stateSchema.safeParse(value); if (!parsed.success || !coherent(parsed.data)) return;
  return parsed.data;
}
const statusBody = (reason: "read_failed" | "stale" | "expired") => reason === "read_failed"
  ? "🗓️ *Agenda indisponível no momento*\n\nNão consegui consultar os horários atuais. Podemos tentar novamente pelo menu ou chamar a equipe."
  : reason === "expired" ? "🗓️ *Consulta de horários expirada*\n\nEsta lista expirou. Abra novamente o serviço para consultar opções atuais."
    : "🗓️ *Vamos atualizar as opções*\n\nOs dados desta seleção mudaram. Consulte novamente o serviço antes de continuar.";
function statusView(reason: "read_failed" | "stale" | "expired", state?: NativeServiceBookingControls): MetaUiView {
  return { stage: "store", title: "Agendamento", body: statusBody(reason), media: [], blocks: [{ type: "service_booking_controls", data: {} }], quickReplies: [], choices: navigation(),
    ...(state ? { serviceBooking: { ...state, model: { step: "status", reason } } } : {}) };
}
/** Presentation from a canonical server read. This snapshot is not booking
 * authority; T46 must independently authenticate, read and revalidate every choice. */
export function buildServiceBookingControls(raw: unknown, now = new Date()): MetaUiView {
  const state = safeState(raw); if (!state) return statusView("stale");
  if (!Number.isFinite(now.getTime()) || state.binding.validUntil <= now.getTime()) return statusView("expired", state);
  const { model } = state; if (model.step === "status") return statusView(model.reason, state);
  const currentSelections = model.step === "prepared" ? model.source.selections : model.step === "slots" && model.source.kind === "slots" ? model.source.selections
    : model.step === "review" && model.source.kind === "selection" ? [model.source.selection] : [];
  if (currentSelections.some(selection => Date.parse(selection.startsAt) <= now.getTime())) return statusView("stale", state);
  const view: MetaUiView = { stage: "store", title: "Agendamento", body: "", media: [], blocks: [{ type: "service_booking_controls", data: {} }], quickReplies: [], choices: [], serviceBooking: state };
  const back = (label: string, target: "services" | "professionals" | "dates" | "slots") => view.choices.push(control(label, { kind: "service_booking", operation: "back", target }));
  if (model.step === "prepared") {
    const source = model.source;
    if (source.payment_mode !== "at_attendance") return statusView("stale", state);
    if (source.requires_hold && source.service_slot_hold && Date.parse(source.service_slot_hold.expiresAt) <= now.getTime()) return statusView("expired", state);
    view.body = "🗓️ *Confirme o agendamento*\n\n" + source.selections.map(value => `*${value.productName}*\n👤 ${value.professionalName}\n📅 ${dateLabel(value.date)} às ${hour(value)}\n🕒 ${zoneLabel(value.timeZone)} · ${value.durationMinutes} min\n💰 *${amount(value)}*`).join("\n\n")
      + "\n\n💳 *Pagamento no atendimento*\nA confirmação abaixo registra o agendamento e o valor pendente; nenhum pagamento antecipado será gerado."
      + (source.requires_hold && source.service_slot_hold ? "\n\n⏳ Reserva temporária até " + new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" }).format(new Date(source.service_slot_hold.expiresAt)) + " (Brasília)."
        : "\n\n_A vaga será validada no momento da confirmação._");
    view.choices.push(control("Confirmar agendamento", { kind: "service_booking", operation: "confirm" }));
    if (model.notice === "button_required") view.body += "\n\n👆 Para confirmar, toque em *Confirmar agendamento* no menu abaixo.";
    view.choices.push(...navigation()); return view;
  }
  if (model.step === "confirmed") {
    const states: Record<string, string> = { pending: "Pendente", scheduled: "Agendado", in_service: "Em atendimento", completed: "Concluído", no_show: "Ausência registrada", cancelled: "Cancelado" };
    view.body = "🗓️ *Agendamento registrado*\n\n" + model.appointments.map(value => `*${value.serviceName}*\n👤 ${value.professionalName}\n📅 ${new Intl.DateTimeFormat("pt-BR", { timeZone: value.timeZone, dateStyle: "short", timeStyle: "short" }).format(new Date(value.startsAt))}\n💰 *${new Intl.NumberFormat("pt-BR", { style: "currency", currency: value.currency }).format(value.priceInCents / 100)}*\n📋 ${states[value.operationalStatus]}\n💳 ${value.paymentStatus === "pending" ? "Pagamento pendente no atendimento" : "Consulte a situação do recebimento com a equipe"}`).join("\n\n");
    back("Ver serviços", "services"); view.choices.push(...navigation()); return view;
  }
  const incomplete = () => view.choices.push(control("Refinar a busca", { kind: "service_booking", operation: "refine" }));
  if (model.step === "services") {
    view.body = model.offers.length ? "🗓️ *Escolha um serviço*\n\nVeja as opções e escolha o atendimento que procura." : model.hasMore ? "🗓️ *Lista de serviços incompleta*\n\nRefine a busca para consultar as opções atuais." : "🗓️ *Serviços*\n\nNão há serviços publicados nesta lista. A equipe pode ajudar com outras informações.";
    view.choices = model.offers.map(offer => control(offer.name, { kind: "service_booking", operation: "offer", ...offerIdentity(offer) }, offer.description));
    if (model.hasMore) { view.body += "\n\n_Esta lista está incompleta; refine a busca para consultar outras opções._"; incomplete(); }
  } else if (model.step === "professionals" && model.source.kind === "professionals") {
    const source = model.source;
    view.body = source.professionals.length ? `👤 *Escolha o profissional*\n\n*${model.offer.name}*\nA disponibilidade será consultada após sua escolha.`
      : source.has_more ? "👤 *Lista de profissionais incompleta*\n\nRefine a busca para consultar as opções atuais." : "👤 *Profissionais*\n\nNão há profissionais publicados nesta lista do serviço. A equipe pode ajudar.";
    view.choices = source.professionals.map(person => control(person.name, { kind: "service_booking", operation: "professional", ...offerIdentity(model.offer), professionalId: person.id, professionalVersion: person.version },
      person.profile?.specialties?.join(", ") || person.profile?.description));
    if (source.has_more) { view.body += "\n\n_Esta lista está incompleta; ela não confirma a disponibilidade de toda a equipe._"; incomplete(); }
    back("Trocar serviço", "services");
  } else if (model.step === "dates" && model.source.kind === "dates") {
    const source = model.source;
    view.body = `📅 *Escolha a data*\n\n*${model.offer.name}*\n👤 ${model.professional.name}\n🕒 ${zoneLabel(source.time_zone)}`
      + (source.dates.length ? "\n\nA disponibilidade será conferida novamente ao escolher um horário." : "\n\nNão há datas disponíveis no período consultado. Podemos verificar outro período com a equipe.");
    view.choices = source.dates.map(date => control(dateLabel(date), { kind: "service_booking", operation: "date", ...offerIdentity(model.offer), professionalId: model.professional.id,
      professionalVersion: model.professional.version, policyVersion: source.policy_version, date }));
    back("Trocar profissional", "professionals");
  } else if (model.step === "slots" && model.source.kind === "slots") {
    const source = model.source;
    const zones = [...new Set(source.selections.map(selection => zoneLabel(selection.timeZone)))];
    view.body = `🕒 *Escolha o horário*\n\n*${model.offer.name}*\n👤 ${model.professional.name}\n📅 ${dateLabel(model.date)}`
      + (zones.length ? "\n" + zones.join("\n") : "")
      + (source.selections.length ? "\n\nSua escolha abre uma revisão do atendimento." : "\n\nNão há horários disponíveis nesta data consultada. Escolha outra data ou fale com a equipe.");
    view.choices = source.selections.map(selection => control(hour(selection), { kind: "service_booking", operation: "slot", selection }, `${selection.durationMinutes} min · ${amount(selection)}`));
    if (source.has_more) { view.body += "\n\n_Há mais opções na origem; refine a busca para consultá-las._"; incomplete(); }
    back("Trocar data", "dates");
  } else if (model.step === "review" && model.source.kind === "selection") {
    const source = model.source, selection = source.selection;
    view.body = `🗓️ *Revise seu atendimento*\n\n*${source.serviceName}*\n👤 ${source.professionalName}\n📅 ${dateLabel(selection.date)} às ${hour(selection)}\n🕒 ${zoneLabel(selection.timeZone)} · ${selection.durationMinutes} min\n💰 *${amount(selection)}*`
      + (source.policy.paymentMode === "at_attendance" ? "\n💳 Pagamento no atendimento." : "\n💳 Pagamento online, conforme as opções disponíveis ao continuar.")
      + "\n\n_O agendamento ainda não foi confirmado. A vaga e as condições serão conferidas ao continuar._";
    if (model.notice === "button_required") view.body += "\n\n👆 Para continuar, toque em *Continuar agendamento* no menu abaixo.";
    view.choices.push(control("Continuar agendamento", { kind: "service_booking", operation: "continue", selection }));
    back("Trocar horário", "slots");
  }
  view.choices.push(...navigation()); return view;
}
export function isServiceBookingView(view?: MetaUiView): boolean { return !!view?.blocks.some(block => block.type === "service_booking_controls"); }

/** Called only after the existing text resolver found one exact visible label.
 * Rebind its draft to the original current map, never create a new action. */
export function currentServiceControlDraft(value: unknown, state: WhatsAppConversationState): NativeServiceBookingAction | undefined {
  if (!isServiceBookingView(state.view) || !state.revision) return;
  const draft = nativeServiceBookingActionSchema.safeParse(value); if (!draft.success) return;
  const withoutRevision = ({ uiRevision: _revision, ...rest }: NativeServiceBookingAction) => rest;
  const current = Object.values(state.selections ?? {}).flatMap(value => {
    const parsed = nativeServiceBookingActionSchema.safeParse(value);
    return parsed.success && parsed.data.uiRevision === state.revision && isDeepStrictEqual(withoutRevision(parsed.data), withoutRevision(draft.data)) ? [parsed.data] : [];
  });
  return current.length === 1 ? current[0] : undefined;
}

/** Existing revision-derived native IDs remain the only external selection
 * IDs. Service data does not become a credential, URL or model tool argument. */
export function presentServiceBookingControls(view: MetaUiView, revision: string, requestedPage = 0,
  options: { native?: boolean; navigationOnly?: boolean; now?: Date; formatSpeech?: (value: string) => string } = {}): MetaUiPresentation {
  const now = options.now ?? new Date(), current = view.serviceBooking ? buildServiceBookingControls(view.serviceBooking, now) : view;
  const fixed = current.choices.filter(choice => choice.action.kind !== "service_booking" || ["back", "refine", "continue", "confirm"].includes(choice.action.operation));
  const entries = current.choices.filter(choice => !fixed.includes(choice));
  const pageSize = Math.max(1, Math.min(PAGE_SIZE, 8 - fixed.length));
  const totalPages = Math.max(1, Math.ceil(entries.length / pageSize));
  const page = Number.isSafeInteger(requestedPage) ? Math.max(0, Math.min(requestedPage, totalPages - 1)) : 0;
  const pageEntries = entries.slice(page * pageSize, (page + 1) * pageSize);
  const choices = [...pageEntries];
  if (page > 0) choices.push(control("Página anterior", { kind: "service_booking", operation: "page", page: page - 1 }));
  if (page < totalPages - 1) choices.push(control("Mais opções", { kind: "service_booking", operation: "page", page: page + 1 }));
  choices.push(...fixed);
  if (choices.length > 10) throw new Error("service_booking_native_limit");
  const selections: Record<string, StoreUiAction> = {}, numericSelections: StoreUiAction[] = [];
  const rows = choices.map((choice, index) => {
    const action: StoreUiAction = choice.action.kind === "service_booking" ? { ...choice.action, uiRevision: revision } : choice.action;
    const key = "zyon:" + createHash("sha256").update(`${revision}:service:${page}:${index}`).digest("hex").slice(0, 32);
    selections[key] = action; numericSelections.push(action);
    return { id: key, title: clip(choice.label, 24), ...(choice.description ? { description: clip(choice.description, 72) } : {}) };
  });
  const speak = options.formatSpeech ?? ((value: string) => value.startsWith("🤖") ? value : "🤖 " + value);
  const messages: MetaUiMessage[] = [];
  const textMessages = (value: string) => {
    let remaining = value;
    while (remaining.length) {
      let end = Math.min(3500, remaining.length);
      if (end < remaining.length) { const boundary = remaining.lastIndexOf("\n", end); if (boundary > end / 2) end = boundary; }
      if (end < remaining.length && /[\uD800-\uDBFF]/.test(remaining[end - 1]!)) end--;
      messages.push({ type: "text", text: { body: speak(remaining.slice(0, end)) } }); remaining = remaining.slice(end).trim();
    }
  };
  if (!options.navigationOnly) textMessages(current.body);
  const fullNames = pageEntries.filter(choice => Array.from(choice.label).length > 24).map((choice, index) => `${index + 1}. *${choice.label}*${choice.description ? "\n" + choice.description : ""}`);
  if (fullNames.length) textMessages(fullNames.join("\n\n"));
  const prompt = `${current.title}\nEscolha uma opção abaixo.${totalPages > 1 ? `\nPágina ${page + 1} de ${totalPages}` : ""}`;
  if (options.native !== false) messages.push({ type: "interactive", interactive: { type: "list", body: { text: prompt }, action: { button: "Ver opções", sections: [{ title: "Agendamento", rows }] } } });
  else textMessages(prompt + "\n\n" + choices.map((choice, index) => `${index + 1}. ${choice.label}${choice.description ? " — " + choice.description : ""}`).join("\n"));
  return { messages, selections, numericSelections, page, totalPages };
}

/** UI replay/freshness checks only. Success deliberately grants no financial or
 * booking authority: T46 must verify the real inbox/lease/phone owner and call
 * canonical reads/commands again. Raw model flags cannot satisfy these checks. */
export function checkServiceControlFreshness(input: { action: unknown; state: WhatsAppConversationState;
  turn: Readonly<VerifiedWhatsAppTurn> | undefined; now: Date }):
  { ok: false; reason: "not_current" | "scope_changed" | "expired" | "button_required" }
  | { ok: true; action: NativeServiceBookingAction; requiresRevalidation: true; authorizesConfirmation: false; authorizesPayment: false } {
  const parsed = nativeServiceBookingActionSchema.safeParse(input.action), snapshot = safeState(input.state.view?.serviceBooking), turn = input.turn;
  if (!parsed.success || !snapshot || !turn || !input.state.revision || parsed.data.uiRevision !== input.state.revision) return { ok: false, reason: "not_current" };
  if (!Number.isFinite(input.now.getTime()) || snapshot.binding.validUntil <= input.now.getTime()) return { ok: false, reason: "expired" };
  const binding = snapshot.binding;
  if (binding.merchantId !== turn.scope.merchantId || binding.configId !== turn.scope.configId || binding.whatsappSessionId !== turn.scope.whatsappSessionId
    || binding.conversationId !== turn.conversationId || input.state.conversationId !== turn.conversationId) return { ok: false, reason: "scope_changed" };
  const matches = (value: unknown) => isDeepStrictEqual(value, parsed.data);
  if (Object.values(input.state.selections ?? {}).filter(matches).length !== 1) return { ok: false, reason: "not_current" };
  const expected = presentServiceBookingControls(input.state.view!, input.state.revision, input.state.page, { now: input.now });
  if (Object.values(expected.selections).filter(matches).length !== 1) return { ok: false, reason: "not_current" };
  if ((parsed.data.operation === "continue" || parsed.data.operation === "confirm") && turn.origin !== "button") return { ok: false, reason: "button_required" };
  return { ok: true, action: parsed.data, requiresRevalidation: true, authorizesConfirmation: false, authorizesPayment: false };
}
