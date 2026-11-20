/** Loopback-only synthetic browser harness. Never imported by application runtime. */
import { Body, Controller, Get, Post, Req, UnauthorizedException, UseGuards, BadRequestException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createFiscalConversationHarness } from "./fiscal-conversation-harness.js";
import { buildExperienceFromSession } from "../src/modules/checkout/application/services/checkout-experience.service.js";
import { deriveChatStage } from "../src/modules/checkout/domain/services/customer-extraction.service.js";
import { CreatePaymentIntentUseCase } from "../src/modules/payment/application/create-payment-intent.use-case.js";
import { createFiscalFixture } from "./fiscal-fixture.js";
import { seedFiscalSale } from "./fiscal-schema-seed.js";
import { FiscalCheckoutController } from "../src/modules/fiscal/presentation/fiscal-checkout.controller.js";
import { FiscalRecipientUpdateService } from "../src/modules/fiscal/application/fiscal-recipient-update.service.js";
import { PrismaFiscalRecipientRepository } from "../src/modules/fiscal/infrastructure/prisma-fiscal-recipient.repository.js";
import { FiscalBeforePaymentService } from "../src/modules/fiscal/application/fiscal-before-payment.service.js";
import { FiscalProfileService } from "../src/modules/fiscal/application/fiscal-profile.service.js";
import { PrismaFiscalProfileRepository } from "../src/modules/fiscal/infrastructure/prisma-fiscal-profile.repository.js";
import { PrismaFiscalCheckoutReader } from "../src/modules/fiscal/infrastructure/prisma-fiscal-checkout.reader.js";
import { TenantContextService } from "../src/shared/tenant/tenant-context.service.js";
import { BuyerJwtService } from "../src/modules/buyer-account/domain/services/buyer-jwt.service.js";
import { EmbedTokenService, type EmbedTokenClaims } from "../src/modules/embed/domain/embed-token.service.js";
import { EmbedAuthGuard } from "../src/modules/embed/presentation/http/embed-auth.guard.js";
import { RequireEmbedScope } from "../src/modules/embed/presentation/http/embed-scope.decorator.js";
import { UpdateEmbedCustomerUseCase } from "../src/modules/embed/application/update-embed-customer.use-case.js";
import { PrismaCheckoutRepository } from "../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { embedCheckoutSessionId } from "../src/modules/embed/domain/embed-checkout-session.js";
import { ViaCepFiscalAddressLookup } from "../src/modules/fiscal/infrastructure/viacep-fiscal-address.lookup.js";
import { FiscalRecipientPreparationService } from "../src/modules/fiscal/application/fiscal-recipient-preparation.service.js";

let fixture: Awaited<ReturnType<typeof createFiscalFixture>>;
let service: FiscalRecipientUpdateService;
let gate: FiscalBeforePaymentService;
let store: PrismaFiscalRecipientRepository;
let registration: UpdateEmbedCustomerUseCase;
let conversation: ReturnType<typeof createFiscalConversationHarness>;
let scenario: { merchantId: string; sessionId: string; token: string; charges: number; confirmations: number; mode: string; cardMode: "stripe" | "hosted"; lastMethod?: string };
const tokens = new EmbedTokenService({ value: Buffer.from("fiscal-browser-synthetic-32-byte-secret") });
const personal = { fullName: "Comprador", email: "buyer@example.test", cpf: "52998224725", phone: "31999999999" };
let currentPersonal = { ...personal };
const address = { zip: "01001000", street: "Rua Um", number: "12", complement: "", neighborhood: "Centro", city: "Sao Paulo", state: "SP" };
const cart = { currency: "BRL", total: 100, items: [{ sku: "sku_a", name: "Camiseta", price: 50, quantity: 2, productType: "physical" }] };
async function experience() {
  const session = await conversation.sessions.getSession(scenario.merchantId, scenario.sessionId);
  return { ...buildExperienceFromSession(session!, { serviceFee: 0, merchantName: "Loja fiscal local" }), paymentMethods: { pix: true, card: scenario.mode !== "buyer_pix_only" } };
}
@Controller()
class BrowserFixtureController {
  @Post("__scenario")
  async setup(@Body() body: { mode: string; cardMode?: "stripe" | "hosted" }) {
    const sale = await seedFiscalSale(fixture); const now = Math.floor(Date.now() / 1000);
    const token = tokens.sign({ typ: "aacp_embed_v1", merchantId: sale.merchantId, nonce: sale.orderId, issuedAtUnix: now, expiresAtUnix: now + 3600,
      allowedOrigin: "http://127.0.0.1:5174", scopes: ["checkout:track"] });
    const sessionId = embedCheckoutSessionId(tokens.verify(token));
    currentPersonal = { ...personal, ...(body.mode.includes("missing_cpf") || body.mode.startsWith("inactive_guest") ? { cpf: "" } : body.mode.startsWith("buyer_invalid_cpf") ? { cpf: "11111111111" } : {}) };
    // Explicit legacy/API recipient fixtures retain CNPJ coverage without a payment selector.
    const legacyRecipient = !body.mode.startsWith("buyer_") && !body.mode.startsWith("inactive");
    await fixture.prisma.checkoutSession.create({ data: { merchantId: sale.merchantId, sessionId, globalUserId: "browser_buyer", conversationId: sessionId, cart,
      customer: body.mode === "buyer_guest_all" ? {} : { ...currentPersonal, email_verified: true, ...(legacyRecipient ? { fiscalRecipientMode: "other" } : {}), address: { ...address, ...(body.mode === "buyer_missing_number" ? { number: "" } : {}) }, address_verified: true },
      shipping: body.mode === "buyer_guest_all" ? Prisma.DbNull : { customerPrice: 0, method: "free", ...(body.mode.includes("marketplace") ? { marketplace: {} } : {}) }, createdAt: new Date(), updatedAt: new Date() } });
    if (!body.mode.startsWith("inactive")) await fixture.prisma.fiscalConnection.update({ where: { id: sale.connection.id }, data: { isActive: true, activatedAt: new Date("2026-01-01") } });
    scenario = { merchantId: sale.merchantId, sessionId, token, charges: 0, confirmations: 0, mode: body.mode, cardMode: body.cardMode ?? "stripe" }; return scenario;
  }
  @Get("__state")
  async state() { const session = await store.getSession(scenario.merchantId, scenario.sessionId);
    return { recipient: Object.keys(session?.customer?.fiscalRecipient ?? {}).length ? session!.customer!.fiscalRecipient : null, customer: session?.customer, history: (await conversation.sessions.getSession(scenario.merchantId, scenario.sessionId))?.chatHistory, personalCpf: session?.customer?.cpf, cart: session?.cart, charges: scenario.charges, lastMethod: scenario.lastMethod, confirmations: scenario.confirmations }; }
  @Post("__close")
  close() { setTimeout(() => { void fixture.close().then(() => process.exit(0)); }, 100); return { ok: true }; }
  @Post("embed/start")
  async start() { return { session_id: scenario.sessionId, experience: await experience(), fiscal: await service.prepare({ merchantId: scenario.merchantId, sessionId: scenario.sessionId }) }; }
  @Get("embed/payment/current")
  current() { return { version: 1, session_id: scenario.sessionId, marketplace: false, payment: null }; }
  @Post("embed/chat")
  @UseGuards(EmbedAuthGuard)
  @RequireEmbedScope("checkout:track")
  async chat(@Req() request: { embedClaims: EmbedTokenClaims }, @Body() body: { session_id: string; user_message: string }) {
    if (body.session_id !== embedCheckoutSessionId(request.embedClaims)) throw new UnauthorizedException("checkout_ownership_required");
    const result = await conversation.chat.execute({ merchant_id: request.embedClaims.merchantId, session_id: body.session_id, user_message: body.user_message }, { checkoutSessionBound: true });
    // Some scenarios replay payment controls that were already present before a required-data correction.
    const previousControls = scenario.mode.endsWith("_controls") && body.user_message === "Quero continuar" && result.stage === "data_collection";
    return { ...result, ...(previousControls ? { blocks: [{ type: "payment_methods", data: { methods: [{ key: "pix", label: "Pix" }, { key: "credito", label: "Cartão de crédito" }, { key: "debito", label: "Cartão de débito" }] } }] } : {}), ...(result.experience ? { experience: { ...result.experience, paymentMethods: { pix: true, card: scenario.mode !== "buyer_pix_only" } } } : {}) };
  }
  @Post("embed/payment/intents")
  async pay(@Body() body: { method: string }) {
    const canonical = await conversation.sessions.getSession(scenario.merchantId, scenario.sessionId);
    if (deriveChatStage(canonical!) === "data_collection") throw new BadRequestException("checkout_customer_data_required");
    if (scenario.mode.includes("marketplace")) {
      // Actual persisted-scope fence, deliberately lacking any funding/quote setup in this scenario.
      const guarded = new CreatePaymentIntentUseCase(conversation.sessions, {} as never, {} as never, { createPayment: async () => { scenario.charges++; throw new Error("unconfigured marketplace reached PSP"); } } as never, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, fixture.prisma, undefined, undefined, undefined, undefined, undefined, gate);
      return guarded.execute({ merchant_id: scenario.merchantId, session_id: scenario.sessionId, idempotency_key: "synthetic_marketplace_guard", method: body.method as "pix" | "card" }, { marketplaceSurface: "embed" });
    }
    const session = await store.getSession(scenario.merchantId, scenario.sessionId); await gate.assertBeforePayment(session!);
    scenario.charges++;
    scenario.lastMethod = body.method;
    return { id: "synthetic_intent", status: "requires_action", method: body.method, amountCents: 10000,
      buyerFacing: body.method === "card" ? scenario.cardMode === "hosted" ? { invoiceUrl: "https://checkout.example.test/fiscal-card" }
        : { clientSecret: "pi_fiscal_secret_synthetic", stripePublishableKey: "pk_test_fiscal_synthetic" }
        : { qrCodeCopyPaste: "synthetic_pix_no_value", quoteExpiresAt: new Date(Date.now() + 600_000).toISOString() } };
  }
  @Post("embed/payment/intents/synthetic_intent/stripe/confirm")
  confirm() { scenario.confirmations++; return { status: "approved", intent_id: "synthetic_intent" }; }
  @Post("embed/customer/update")
  @UseGuards(EmbedAuthGuard)
  @RequireEmbedScope("checkout:track")
  async updateCustomer(@Req() request: { embedClaims: EmbedTokenClaims }, @Body() body: { session_id: string; customer: { fullName: string; email: string; cpf: string; phone: string } }) {
    const claims = request.embedClaims;
    if (body.session_id !== embedCheckoutSessionId(claims)) throw new UnauthorizedException("checkout_ownership_required");
    const result = await registration.execute({ merchantId: claims.merchantId, sessionId: body.session_id, customer: body.customer });
    currentPersonal = { ...currentPersonal, ...body.customer };
    return result;
  }
  @Get("embed/payment/intents/:id/status")
  status() { return { status: "requires_action" }; }
  @Get("checkout-settings/widget-config")
  settings() { return { enabledTriggers: [], advancedRules: [], maxInterventionsPerSession: 0 }; }
  @Get("support/faq/public")
  faq() { return { faqItems: [] }; }
  @Get("embed/checkout/consent/campaigns")
  consent() { return { channels: [] }; }
  @Post("embed/track")
  track() { return { ok: true }; }
}
fixture = await createFiscalFixture({ controllers: [FiscalCheckoutController, BrowserFixtureController], providers: [
  { provide: FiscalRecipientUpdateService, useValue: { update: (...args: Parameters<FiscalRecipientUpdateService["update"]>) => service.update(...args),
    lookupAddress: (...args: Parameters<FiscalRecipientUpdateService["lookupAddress"]>) => service.lookupAddress(...args),
    prepare: (...args: Parameters<FiscalRecipientUpdateService["prepare"]>) => service.prepare(...args) } },
  { provide: BuyerJwtService, useValue: new BuyerJwtService("browser-synthetic-buyer-32-byte-secret") }, { provide: EmbedTokenService, useValue: tokens }, EmbedAuthGuard,
] });
process.stdin.on("end", () => { void fixture.close().then(() => process.exit(0)); });
process.stdin.resume();
for (const node of [fixture.first, fixture.second]) node.app.enableCors({ origin: "http://127.0.0.1:5174" });
store = new PrismaFiscalRecipientRepository(fixture.prisma);
registration = new UpdateEmbedCustomerUseCase(new PrismaCheckoutRepository(fixture.prisma), { publish: async () => [] } as never, { dispatchDelivery: async () => {} } as never);
const postal = new ViaCepFiscalAddressLookup((async (url: string | URL | Request) => {
  if (scenario.mode === "lookup_failed") throw new Error("synthetic_lookup_unavailable");
  const otherCity = String(url).includes("30130010");
  return Response.json({ cep: otherCity ? "30130-010" : "01001-000", logradouro: "Rua Um", bairro: "Centro", localidade: otherCity ? "Belo Horizonte" : "Sao Paulo", uf: otherCity ? "MG" : "SP",
    ...(scenario.mode !== "lookup_missing_ibge" ? { ibge: otherCity ? "3106200" : "3550308" } : {}) });
}) as typeof fetch);
const preparation = new FiscalRecipientPreparationService(store, postal);
gate = new FiscalBeforePaymentService(new PrismaFiscalCheckoutReader(fixture.prisma, "homologation", new TenantContextService()),
  new FiscalProfileService(new PrismaFiscalProfileRepository(fixture.prisma), { find: () => undefined }), preparation);
service = new FiscalRecipientUpdateService(store, gate, postal, preparation);
conversation = createFiscalConversationHarness(fixture.prisma, gate, postal, { execute: async (input: { method: string; merchant_id: string; session_id: string }) => ({ ...(await new BrowserFixtureController().pay(input)), merchantId: input.merchant_id, sessionId: input.session_id, currency: "BRL" }) } as never);
console.log("FISCAL_BROWSER_READY " + fixture.first.url + "/v1");
