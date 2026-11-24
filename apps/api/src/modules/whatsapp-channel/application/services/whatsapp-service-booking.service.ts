import { BadRequestException, ConflictException } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { addBusinessDays, businessDateKey } from "../../../../shared/analytics/business-period.js";
import { assertNativeServiceBookingGesture, revalidateNativeServiceBookingAdmission } from "../../../../shared/bookings/native-service-booking-authority.js";
import { serviceBookingParentFingerprint } from "../../../../shared/bookings/service-checkout-provenance.js";
import { confirmServiceAppointment } from "../../../checkout/application/confirm-service-appointment.use-case.js";
import { ServiceBookingService } from "../../../checkout/application/service-booking.service.js";
import { PublicServiceBookingReader } from "../../../checkout/application/public-service-booking-reader.js";
import { revalidateNativePublicServiceReadScope } from "../../../../shared/bookings/native-public-service-read-scope.js";
import { toCheckoutSession } from "../../../checkout/infrastructure/prisma/checkout-session.mapper.js";
import { deriveChatStage } from "../../../checkout/domain/services/customer-extraction.service.js";
import { paymentCartFingerprint } from "../../../checkout/domain/services/payment-cart-fingerprint.js";
import { nativeServiceBookingActionSchema, buildServiceBookingControls } from "../../domain/ui/service-booking-controls.js";
import { nativeServicePreparedSummarySchema } from "../../domain/ui/native-service-prepared-summary.js";
import { lockStorefrontCart } from "../../../../shared/persistence/storefront-cart-lock.js";
import { withStorefrontCartInTransaction } from "../../../storefront/infrastructure/repositories/storefront-cart-transaction.js";
import { storefrontCartHasCheckoutBinding } from "../../../storefront/infrastructure/repositories/storefront-checkout-binding-fence.js";
import type { ServiceSlotHoldsService } from "../../../../shared/bookings/service-slot-holds.service.js";
import { readProfessionalCheckout } from "../../../../shared/bookings/read-professional-checkout.js";
import { createServiceBookingHandlers } from "../../../storefront/infrastructure/tool-handlers/service-booking.handlers.js";
import { serviceBookingResultSchema } from "../../../storefront/domain/contracts/service-booking-tool.schemas.js";
import type { ScopedServiceBookingReader, StorefrontServiceBookingFactory } from "../../../storefront/domain/ports/service-booking-tools.port.js";
import type { WhatsAppStructuredResponse, WhatsAppConversationState } from "../../domain/ui/meta-ui.types.js";
import { WhatsAppServiceBookingAuthority, type NativeServiceDispatchInput, type NativeServiceReadDispatchContext, type NativePublicServiceDispatchContext } from "./whatsapp-service-booking-authority.js";

type Input = NativeServiceDispatchInput & { message?: string; action?: unknown };
export type NativeServiceCheckoutRenderer = (state: WhatsAppConversationState, session: ReturnType<typeof toCheckoutSession>) => Promise<WhatsAppStructuredResponse>;
const record = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

/** Native transport adapter only. T40 readers/prepare, ordinary checkout data/
 * payment controls and canonical confirmation keep their existing writers. */
export class WhatsAppServiceBookingService {
  constructor(private readonly prisma: PrismaClient, private readonly authority: WhatsAppServiceBookingAuthority,
    private readonly booking: ServiceBookingService, private readonly holds: ServiceSlotHoldsService,
    private readonly publicReader = new PublicServiceBookingReader(prisma)) {}

  private async publicPublishedRead<T>(context: NativePublicServiceDispatchContext, read: (tx: Prisma.TransactionClient) => Promise<T>) {
    return this.prisma.$transaction(async tx => {
      await revalidateNativePublicServiceReadScope(tx, context.scope);
      const result = await read(tx);
      await revalidateNativePublicServiceReadScope(tx, context.scope);
      return result;
    }, { timeout: 15_000 });
  }

  private professionals(context: NativeServiceReadDispatchContext, args: Parameters<ServiceBookingService["professionals"]>[1]) {
    return context.readOnly === true ? this.publicReader.professionals(context.scope, args) : this.booking.professionals(context.scope, args);
  }
  private dates(context: NativeServiceReadDispatchContext, args: Parameters<ServiceBookingService["dates"]>[1]) {
    return context.readOnly === true ? this.publicReader.dates(context.scope, args) : this.booking.dates(context.scope, args);
  }
  private slots(context: NativeServiceReadDispatchContext, args: Parameters<ServiceBookingService["slots"]>[1]) {
    return context.readOnly === true ? this.publicReader.slots(context.scope, args) : this.booking.slots(context.scope, args);
  }
  private preview(context: NativeServiceReadDispatchContext, args: Parameters<ServiceBookingService["select"]>[1]) {
    return context.readOnly === true ? this.publicReader.preview(context.scope, args) : this.booking.select(context.scope, args);
  }

  private response(context: NativeServiceReadDispatchContext, model: unknown, state = context.state): WhatsAppStructuredResponse {
    const view = buildServiceBookingControls({ binding: context.uiBinding, model }, context.now), history = state.history.slice();
    const message = context.turn.message.trim() || "Escolha no menu de agendamento.";
    if (history.at(-1)?.role === "assistant" && history.at(-2)?.role === "user" && history.at(-2)?.content === message)
      history[history.length - 1] = { role: "assistant", content: view.body.slice(0, 8000) };
    else history.push({ role: "user", content: message }, { role: "assistant", content: view.body.slice(0, 8000) });
    return { agentMessage: view.body, quickReplies: [], blocks: [{ type: "service_booking_controls", data: {} }],
      state: { ...state, stage: "store", expectsFreeInput: false, history: history.slice(-24), serviceBooking: view.serviceBooking } };
  }
  private sourceMatches(source: unknown, selections: Array<{ slotId: string; productId: string; variantId: string; priceInCents: number }>): boolean {
    const cart = record(source), items = cart.items;
    return Array.isArray(items) && items.length === selections.length && cart.discount === 0 && cart.couponCode === null && cart.freeShipping === false
      && selections.every(value => items.filter(raw => { const item = record(raw); return item.productId === value.productId && item.variantId === value.variantId
        && item.quantity === 1 && item.unitPriceCents === value.priceInCents && item.selectedServiceSlot?.slotId === value.slotId
        && !item.marketplace && !item.crossSellIntent && !item.selectedOptions?.length; }).length === 1);
  }
  private async offer(context: NativeServiceReadDispatchContext, productId: string, variantId: string) {
    if (context.readOnly === true) return this.publicPublishedRead(context, async tx => {
    const product = await tx.product.findFirst({ where: { id: productId, merchantId: context.scope.merchantId,
      type: "service", isActive: true, deletedAt: null, variants: { some: { id: variantId, isActive: true } } }, select: { id: true, name: true } });
    if (!product) throw new ConflictException("professional_service_not_found");
    return { productId, variantId, name: product.name };
    });
    const product = await this.prisma.product.findFirst({ where: { id: productId, merchantId: context.scope.merchantId,
      type: "service", isActive: true, deletedAt: null, variants: { some: { id: variantId, isActive: true } } }, select: { id: true, name: true } });
    if (!product) throw new ConflictException("professional_service_not_found");
    return { productId, variantId, name: product.name };
  }
  async isServices(merchantId: string): Promise<boolean> {
    const merchant = await this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true } });
    return merchant?.businessMode === "services" && !!merchant.businessModeSelectedAt && !merchant.businessModeNeedsReview;
  }
  async entry(input: NativeServiceDispatchInput & { message: string; action?: unknown }): Promise<WhatsAppStructuredResponse | undefined> {
    const action = record(input.action), message = action.kind === "message" ? action.message : input.message;
    if (typeof message !== "string" || !["/servicos", "agendar atendimento", "ver serviços", "ver servicos"].includes(message.trim().toLocaleLowerCase("pt-BR"))
      || !await this.isServices(input.merchantId)) return;
    return await this.open({ ...input, action: undefined }) ?? this.identityNeeded(input.state);
  }
  private identityNeeded(state: WhatsAppConversationState): WhatsAppStructuredResponse {
    return { agentMessage: "👤 Para identificar o cadastro deste telefone, abra *Meus dados* e informe o e-mail que já utiliza. Depois, volte ao agendamento.",
      quickReplies: ["👤 Meus dados", "Menu principal", "Falar com atendente"], blocks: [], state };
  }
  async decorateMenu(merchantId: string, response: WhatsAppStructuredResponse): Promise<WhatsAppStructuredResponse> {
    if (!response.blocks.some(block => block.type === "buyer_hub_actions" && block.data.scope === "main_menu") || !await this.isServices(merchantId)) return response;
    return { ...response, quickReplies: ["Agendar atendimento", "👤 Meus dados", "📍 Meus endereços", "💬 Ajuda da loja", "Falar com atendente"] };
  }
  /** Private readonly binding for the shared text/voice agent. Its callbacks
   * reopen genuine native admission per call; no embed credentials are invented. */
  storeBinding(input: NativeServiceDispatchInput): { factory: StorefrontServiceBookingFactory;
    present(output: { blocks: Array<{ type: string; data: unknown }> }): Promise<WhatsAppStructuredResponse | undefined> } {
    const readInput: NativeServiceDispatchInput = { merchantId: input.merchantId, state: input.state, verifiedSender: input.verifiedSender };
    let captured: { operation: "professionals" | "dates" | "slots" | "select"; args: any; raw: any } | undefined;
    let last: NativeServiceReadDispatchContext | undefined;
    const run = async <T>(operation: "professionals" | "dates" | "slots" | "select", args: unknown,
      read: (context: NativeServiceReadDispatchContext) => Promise<T>) => {
      const result = await this.authority.runRead(readInput, async context => {
        const raw = await read(context); last = context;
        captured = structuredClone({ operation, args, raw }); return raw;
      });
      if (!result) throw new ConflictException("whatsapp_service_authority_required"); return result;
    };
    const reader: ScopedServiceBookingReader = { professionals: args => run("professionals", args, context => this.professionals(context, args)),
      dates: args => run("dates", args, context => this.dates(context, args)), slots: args => run("slots", args, context => this.slots(context, args)),
      offerName: async args => {
        const value = await this.authority.runRead(readInput, async context => { last = context; return (await this.offer(context, args.productId, args.variantId)).name; });
        if (value === undefined) throw new ConflictException("whatsapp_service_authority_required"); return value;
      } };
    const factory: StorefrontServiceBookingFactory = async binding => {
      if (binding.merchantId !== input.merchantId || binding.conversationId !== input.state.conversationId || binding.cartRef !== input.state.conversationId
        || !await this.isServices(input.merchantId)) return;
      return createServiceBookingHandlers(input.merchantId, async () => {
        return this.authority.runRead(readInput, async context => {
          last = context;
          return context.readOnly === true ? reader : { ...reader, select: (args: Parameters<ServiceBookingService["select"]>[1]) => run("select", args, active => {
            if (active.readOnly === true) throw new ConflictException("whatsapp_service_authority_required");
            return this.booking.select(active.scope, args);
          }) };
        });
      }, () => last ? new Date(last.now.getTime()) : new Date());
    };
    return { factory, present: async output => {
      const block = output.blocks.find(block => block.type === "service_booking"), parsed = block ? serviceBookingResultSchema.safeParse(block.data) : undefined;
      if (!parsed?.success) return;
      const data = parsed.data; if (data.kind === "authentication_required") return this.identityNeeded(input.state);
      if (!captured || !last) return;
      const observed = captured;
      return this.authority.runRead(readInput, async context => {
        const args = record(observed.args.selection ?? observed.args), offer = await this.offer(context, args.productId, args.variantId);
        if (data.kind === "selection" && observed.operation === "select") {
          if (context.readOnly === true) throw new ConflictException("whatsapp_service_authority_required");
          const selected = await this.booking.select(context.scope, { selection: observed.args.selection });
          return this.response(context, { step: "review", offer, source: { kind: "selection", selection: selected.selection,
            serviceName: selected.service.name, professionalName: selected.professional.name, policy: selected.policy,
            action: "review_service_booking", requiresRevalidation: true, authorizesPayment: false, authorizesConfirmation: false } });
        }
        if (data.kind === "professionals" || data.kind === "selection_resolution" && (data.resolution.kind !== "clarification"
          || ["choose_professional", "more_current_professionals"].includes(data.resolution.reason)) || !args.professionalId) {
          const source = await this.professionals(context, { productId: offer.productId, variantId: offer.variantId });
          return this.response(context, { step: "professionals", offer, source: { kind: "professionals", ...source } });
        }
        const person = context.readOnly === true ? await this.publicPublishedRead(context, tx => tx.serviceProfessional.findFirst({
          where: { merchantId: context.scope.merchantId, id: args.professionalId, isActive: true, isPublished: true },
          select: { id: true, publicName: true, version: true } })) : await this.prisma.serviceProfessional.findFirst({ where: { merchantId: context.scope.merchantId, id: args.professionalId,
          isActive: true, isPublished: true }, select: { id: true, publicName: true, version: true } });
        if (!person) throw new ConflictException("service_selection_stale");
        const professional = { id: person.id, name: person.publicName, version: person.version };
        const choice = { productId: offer.productId, variantId: offer.variantId, professionalId: person.id };
        if (data.kind === "slots" || data.kind === "selection_resolution" && data.resolution.kind === "clarification" && data.resolution.reason === "choose_time") {
          const source = await this.slots(context, { ...choice, date: args.date });
          const dated = await this.dates(context, { ...choice, fromDate: args.date, toDate: args.date });
          const visible = context.readOnly === true && data.kind === "slots"
            ? source.selections.filter(value => data.selections.some(selected => isDeepStrictEqual(value, selected))) : source.selections;
          if (context.readOnly === true && data.kind === "slots" && visible.length !== data.selections.length) throw new ConflictException("service_selection_stale");
          return this.response(context, { step: "slots", offer, professional, date: args.date, policyVersion: dated.policy_version,
            source: { kind: "slots", selections: visible.slice(0, 100), has_more: context.readOnly === true && data.kind === "slots" ? data.has_more : source.selections.length > 100 } });
        }
        const dates = data.kind === "selection_resolution" && data.resolution.kind === "clarification" ? data.resolution.options.map(value => value.date).sort() : [];
        const fromDate = args.fromDate ?? dates[0] ?? args.date ?? businessDateKey(context.now), toDate = args.toDate ?? dates.at(-1) ?? args.date ?? addBusinessDays(fromDate, 30);
        const source = await this.dates(context, { ...choice, fromDate, toDate });
        return this.response(context, { step: "dates", offer, professional, source: { kind: "dates", ...source } });
      });
    } };
  }
  async open(input: NativeServiceDispatchInput): Promise<WhatsAppStructuredResponse | undefined> {
    return this.authority.runRead(input, context => this.catalog(context));
  }
  private async catalog(context: NativeServiceReadDispatchContext): Promise<WhatsAppStructuredResponse> {
    if (context.readOnly === true) return this.publicPublishedRead(context, async tx => {
      const merchant = await tx.merchant.findUnique({ where: { id: context.scope.merchantId }, select: { businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true } });
      if (merchant?.businessMode !== "services" || !merchant.businessModeSelectedAt || merchant.businessModeNeedsReview) throw new ConflictException("service_booking_unavailable");
      const products = await tx.product.findMany({ where: { merchantId: context.scope.merchantId, type: "service", isActive: true, deletedAt: null,
        variants: { some: { isActive: true } } }, include: { variants: { where: { isActive: true }, orderBy: { id: "asc" }, take: 3 } }, orderBy: { id: "asc" }, take: 101 });
      // Each active variant is an explicit offer. Do not silently choose the
      // first variant when the service has several selectable offers.
      const offers = products.slice(0, 100).flatMap(product => product.variants.slice(0, 2).map(variant => ({ productId: product.id, variantId: variant.id,
        name: product.name + (product.variants.length > 1 ? " · " + variant.sku : "") })));
      return this.response(context, { step: "services", offers: offers.slice(0, 100), hasMore: products.length > 100 || offers.length > 100 || products.some(product => product.variants.length > 2) });
    });
      const merchant = await this.prisma.merchant.findUnique({ where: { id: context.scope.merchantId }, select: { businessMode: true, businessModeSelectedAt: true, businessModeNeedsReview: true } });
      if (merchant?.businessMode !== "services" || !merchant.businessModeSelectedAt || merchant.businessModeNeedsReview) throw new ConflictException("service_booking_unavailable");
      const products = await this.prisma.product.findMany({ where: { merchantId: context.scope.merchantId, type: "service", isActive: true, deletedAt: null,
        variants: { some: { isActive: true } } }, include: { variants: { where: { isActive: true }, orderBy: { id: "asc" }, take: 3 } }, orderBy: { id: "asc" }, take: 101 });
      // Each active variant is an explicit offer. Do not silently choose the
      // first variant when the service has several selectable offers.
      const offers = products.slice(0, 100).flatMap(product => product.variants.slice(0, 2).map(variant => ({ productId: product.id, variantId: variant.id,
        name: product.name + (product.variants.length > 1 ? " · " + variant.sku : "") })));
      return this.response(context, { step: "services", offers: offers.slice(0, 100), hasMore: products.length > 100 || offers.length > 100 || products.some(product => product.variants.length > 2) });
  }
  /** Contact collection remains with the existing checkout adapter. Only a
   * completed at-attendance checkout replaces its payment surface with the
   * separate actual confirmation gesture. Online/Pix/card stays unchanged. */
  async decorateCheckout(input: NativeServiceDispatchInput, response: WhatsAppStructuredResponse): Promise<WhatsAppStructuredResponse | undefined> {
    if (!response.state.serviceBooking || !response.state.checkoutSessionId || !response.blocks.some(block => block.type === "payment_methods")) return;
    return this.authority.run({ merchantId: input.merchantId, state: input.state, verifiedSender: input.verifiedSender }, async context => {
      if (context.scope.sessionId !== response.state.checkoutSessionId) return response;
      const loaded = await this.prisma.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: context.scope.merchantId, sessionId: context.scope.sessionId } } });
      if (!loaded) throw new ConflictException("checkout_session_not_found");
      const session = toCheckoutSession(loaded);
      if (deriveChatStage(session) === "data_collection" || await this.holds.isCommittedCheckout(session)) return response;
      const held = await this.holds.state(session);
      const source = await this.prisma.$transaction(async tx => {
        await revalidateNativeServiceBookingAdmission(tx, { ...context.scope, globalUserId: context.scope.buyer.globalUserId });
        const current = await readProfessionalCheckout(tx, session), [products, professionals, parent] = await Promise.all([
          tx.product.findMany({ where: { merchantId: context.scope.merchantId, id: { in: current.selections.map(value => value.productId) } }, select: { id: true, name: true } }),
          tx.serviceProfessional.findMany({ where: { merchantId: context.scope.merchantId, id: { in: current.selections.map(value => value.professionalId) } }, select: { id: true, publicName: true } }),
          tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: context.scope.merchantId, sessionId: context.scope.cartRef } } }),
        ]);
        await revalidateNativeServiceBookingAdmission(tx, { ...context.scope, globalUserId: context.scope.buyer.globalUserId });
        return nativeServicePreparedSummarySchema.parse({ session_id: session.sessionId, cart_fingerprint: paymentCartFingerprint(session),
          payment_mode: current.policy.paymentMode, policy_version: current.policyVersion, requires_hold: current.policy.holdEnabled, service_slot_hold: held.service_slot_hold,
          selections: current.selections.map(value => ({ ...value, productName: products.find(product => product.id === value.productId)?.name,
            professionalName: professionals.find(professional => professional.id === value.professionalId)?.publicName })),
          ...(parent && this.sourceMatches(parent, current.selections) ? { source_cart_fingerprint: serviceBookingParentFingerprint(parent as never) } : {}) });
      });
      if (source.payment_mode !== "at_attendance") return response;
      const selected = source.selections.at(-1)!;
      return this.response(context, { step: "prepared", offer: await this.offer(context, selected.productId, selected.variantId), source }, response.state);
    });
  }
  async respond(input: Input, renderCheckout: NativeServiceCheckoutRenderer): Promise<WhatsAppStructuredResponse | undefined> {
    const parsed = nativeServiceBookingActionSchema.safeParse(input.action);
    if (!parsed.success) throw new BadRequestException("invalid_service_booking_action");
    const readOnly = !["continue", "confirm"].includes(String(parsed.data.operation));
    const dispatch = async (context: NativeServiceReadDispatchContext) => {
      const action = parsed.data, current = record(context.state.view?.serviceBooking?.model);
      try {
      const ids = action.operation === "slot" || action.operation === "continue" ? action.selection : record(current.offer);
      if (action.operation === "offer") {
        const source = await this.professionals(context, { productId: action.productId, variantId: action.variantId }), offer = await this.offer(context, action.productId, action.variantId);
        return this.response(context, { step: "professionals", offer, source: { kind: "professionals", ...source } });
      }
      if (action.operation === "professional") {
        const offer = await this.offer(context, action.productId, action.variantId), roster = await this.professionals(context, { productId: action.productId, variantId: action.variantId });
        const person = roster.professionals.find(value => value.id === action.professionalId && value.version === action.professionalVersion);
        if (!person) throw new ConflictException("service_selection_stale");
        const fromDate = businessDateKey(context.now), source = await this.dates(context, { productId: action.productId, variantId: action.variantId,
          professionalId: action.professionalId, fromDate, toDate: addBusinessDays(fromDate, 30) });
        if (source.professional_version !== person.version) throw new ConflictException("service_selection_stale");
        return this.response(context, { step: "dates", offer, professional: { id: person.id, name: person.name, version: person.version }, source: { kind: "dates", ...source } });
      }
      if (action.operation === "date") {
        const offer = await this.offer(context, action.productId, action.variantId), roster = await this.professionals(context, { productId: action.productId, variantId: action.variantId });
        const person = roster.professionals.find(value => value.id === action.professionalId && value.version === action.professionalVersion);
        if (!person) throw new ConflictException("service_selection_stale");
        const dated = await this.dates(context, { productId: action.productId, variantId: action.variantId, professionalId: action.professionalId, fromDate: action.date, toDate: action.date });
        if (dated.professional_version !== action.professionalVersion || dated.policy_version !== action.policyVersion || !dated.dates.includes(action.date)) throw new ConflictException("service_selection_stale");
        const slots = await this.slots(context, { productId: action.productId, variantId: action.variantId, professionalId: action.professionalId, date: action.date });
        return this.response(context, { step: "slots", offer, professional: { id: person.id, name: person.name, version: person.version }, date: action.date,
          policyVersion: dated.policy_version, source: { kind: "slots", selections: slots.selections.slice(0, 100), has_more: slots.selections.length > 100 } });
      }
      if (action.operation === "slot") {
        const selected = await this.preview(context, { selection: action.selection });
        return this.response(context, { step: "review", offer: await this.offer(context, ids.productId, ids.variantId), source: {
          kind: "selection", selection: selected.selection, serviceName: selected.service.name, professionalName: selected.professional.name,
          policy: selected.policy, action: "review_service_booking", requiresRevalidation: true, authorizesPayment: false, authorizesConfirmation: false } });
      }
      if (action.operation === "back") {
        if (action.target === "services") return this.catalog(context);
        const offer = await this.offer(context, ids.productId, ids.variantId), roster = await this.professionals(context, offer);
        if (action.target === "professionals") return this.response(context, { step: "professionals", offer, source: { kind: "professionals", ...roster } });
        const tuple = record(current.source?.selection ?? current.source?.selections?.at(-1)), identity = record(current.professional);
        const person = roster.professionals.find(value => value.id === (identity.id ?? tuple.professionalId));
        if (!person) throw new ConflictException("service_selection_stale");
        const professional = { id: person.id, name: person.name, version: person.version }, fromDate = businessDateKey(context.now);
        if (action.target === "dates") {
          const source = await this.dates(context, { ...offer, professionalId: person.id, fromDate, toDate: addBusinessDays(fromDate, 30) });
          return this.response(context, { step: "dates", offer, professional, source: { kind: "dates", ...source } });
        }
        const date = String(current.date ?? tuple.date), source = await this.slots(context, { ...offer, professionalId: person.id, date });
        const policyVersion = source.selections[0]?.policyVersion ?? (await this.dates(context, { ...offer, professionalId: person.id, fromDate: date, toDate: date })).policy_version;
        return this.response(context, { step: "slots", offer, professional, date, policyVersion, source: { kind: "slots", selections: source.selections.slice(0, 100), has_more: source.selections.length > 100 } });
      }
      if (action.operation === "refine") return { agentMessage: "🔎 Escreva o nome do serviço ou do profissional e a data que deseja consultar. Vou verificar as opções atuais.",
        blocks: [], quickReplies: [], state: { ...context.state, expectsFreeInput: true } };
      if (context.readOnly === true) throw new ConflictException("whatsapp_service_authority_required");
      if (action.operation === "continue") {
        assertNativeServiceBookingGesture(context.scope, "continue");
        const selected = await this.booking.select(context.scope, { selection: action.selection });
        const command = { selection: selected.selection, parent_cart_fingerprint: selected.parent_cart_fingerprint };
        let raw;
        try { raw = await this.booking.prepare(context.scope, command); }
        catch (error) {
          const response = error instanceof ConflictException ? record(error.getResponse()) : {};
          if (response.code !== "service_hold_required" || response.next_action !== "review_checkout") throw error;
          // The current real review button authorizes the separate canonical
          // continuation; a plain prepare replay never acquires a new lease.
          await this.booking.reviewNativeCheckout(context.scope);
          raw = await this.booking.prepare(context.scope, command);
        }
        const prepared = nativeServicePreparedSummarySchema.parse(raw);
        const loaded = await this.prisma.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: context.scope.merchantId, sessionId: context.scope.sessionId } } });
        if (!loaded) throw new ConflictException("service_booking_preparation_unknown");
        const session = toCheckoutSession(loaded), state = { ...context.state, stage: "checkout" as const, checkoutSessionId: session.sessionId };
        if (deriveChatStage(session) === "data_collection" || prepared.payment_mode === "online") return renderCheckout(state, session);
        const source = await this.prisma.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: context.scope.merchantId, sessionId: context.scope.cartRef } } });
        if (source && this.sourceMatches(source, prepared.selections)) prepared.source_cart_fingerprint = serviceBookingParentFingerprint(source as never);
        return this.response(context, { step: "prepared", offer: await this.offer(context, ids.productId, ids.variantId), source: prepared }, state);
      }
      if (String(action.operation) === "confirm") {
        assertNativeServiceBookingGesture(context.scope, "confirm");
        const prepared = nativeServicePreparedSummarySchema.parse(current.source);
        if (current.step !== "prepared" || prepared.payment_mode !== "at_attendance" || prepared.session_id !== context.scope.sessionId) throw new ConflictException("service_confirmation_summary_changed");
        const result = await this.prisma.$transaction(async tx => {
          await revalidateNativeServiceBookingAdmission(tx, { ...context.scope, globalUserId: context.scope.buyer.globalUserId });
          const loaded = await tx.checkoutSession.findUnique({ where: { merchantId_sessionId: { merchantId: context.scope.merchantId, sessionId: context.scope.sessionId } } });
          if (!loaded || deriveChatStage(toCheckoutSession(loaded)) === "data_collection" || paymentCartFingerprint(toCheckoutSession(loaded)) !== prepared.cart_fingerprint)
            throw new ConflictException("service_confirmation_summary_changed");
          const commandId = "wa-service-" + createHash("sha256").update(JSON.stringify([context.scope.merchantId, context.scope.sessionId,
            context.scope.buyer.globalUserId, prepared.cart_fingerprint])).digest("hex");
          const result = await confirmServiceAppointment(tx, { merchantId: context.scope.merchantId, sessionId: context.scope.sessionId,
            globalUserId: context.scope.buyer.globalUserId, origin: "whatsapp" }, { commandId, cartFingerprint: prepared.cart_fingerprint });
          // Clear only this confirmed, unchanged service source through the
          // existing cart writer. A later cart edit or another binding survives.
          if (prepared.source_cart_fingerprint) {
            await lockStorefrontCart(tx, context.scope.merchantId, context.scope.cartRef);
            const source = await tx.storefrontCart.findUnique({ where: { merchantId_sessionId: { merchantId: context.scope.merchantId, sessionId: context.scope.cartRef } } });
            if (source && serviceBookingParentFingerprint(source as never) === prepared.source_cart_fingerprint
              && !await storefrontCartHasCheckoutBinding(tx, context.scope.merchantId, context.scope.cartRef)) {
              await withStorefrontCartInTransaction(tx, context.scope.merchantId, context.scope.cartRef, async (_tx, cart) => {
                if (serviceBookingParentFingerprint(cart) !== prepared.source_cart_fingerprint) throw new ConflictException("service_booking_parent_changed");
                cart.items = [];
              });
            }
          }
          await revalidateNativeServiceBookingAdmission(tx, { ...context.scope, globalUserId: context.scope.buyer.globalUserId });
          return result;
        });
        return this.response(context, { step: "confirmed", appointments: result.appointments.map(appointment => {
          const selected = prepared.selections.find(value => value.productId === appointment.productId && value.professionalId === appointment.professionalId
            && value.startsAt === appointment.startsAt.toISOString());
          const payment = appointment.payments.find(payment => payment.mode === "at_attendance");
          if (!selected || !payment) throw new ConflictException("service_confirmation_receipt_invalid");
          return { id: appointment.id, serviceName: selected.productName, professionalName: selected.professionalName, startsAt: appointment.startsAt.toISOString(),
            endsAt: appointment.endsAt.toISOString(), timeZone: appointment.timeZone, priceInCents: appointment.priceInCents, currency: appointment.currency,
            operationalStatus: appointment.operationalStatus, paymentStatus: payment.status };
        }) }, { ...context.state, checkoutSessionId: prepared.session_id });
      }
      // Local page handling remains with T44, outside business writers.
      throw new BadRequestException("service_booking_read_navigation_required");
      } catch (error) {
        if (!readOnly) throw error;
        return this.response(context, { step: "status", reason: error instanceof ConflictException || error instanceof BadRequestException ? "stale" : "read_failed" });
      }
    };
    const result = readOnly ? await this.authority.runRead(input, dispatch) : await this.authority.run(input, dispatch);
    return result ?? (!readOnly ? this.identityNeeded(input.state) : undefined);
  }
}
