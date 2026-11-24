import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { Module, type FactoryProvider } from "@nestjs/common";
import { MODULE_METADATA } from "@nestjs/common/constants.js";
import { NestFactory } from "@nestjs/core";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import { ServiceSlotHoldsService } from "../../../../shared/bookings/service-slot-holds.service.js";
import { ServiceBookingService } from "../../../checkout/application/service-booking.service.js";
import { WhatsAppTurnContext } from "../../domain/services/whatsapp-turn-context.js";
import { WhatsAppCheckoutIdentityService } from "./whatsapp-checkout-identity.service.js";
import { WhatsAppServiceBookingAuthority } from "./whatsapp-service-booking-authority.js";
import { WhatsAppServiceBookingService } from "./whatsapp-service-booking.service.js";
import { WhatsAppChannelModule } from "../../whatsapp-channel.module.js";
import { CheckoutWhatsAppConversationAdapter } from "../../infrastructure/adapters/checkout-whatsapp-conversation.adapter.js";
function provider<T>(token: new (...args: any[]) => T): FactoryProvider<T> {
  const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, WhatsAppChannelModule) as unknown[];
  const value = providers.find((value): value is FactoryProvider<T> => !!value && typeof value === "object" && "provide" in value && value.provide === token);
  assert.ok(value, "actual channel module factory required"); return value;
}
test("T46 native production composition", async t => {
  await t.test("factories reuse the original private turn, buyer recognizer, checkout and global holds", () => {
    assert.deepEqual(provider(WhatsAppServiceBookingAuthority).inject, [PRISMA_CLIENT, WhatsAppTurnContext, WhatsAppCheckoutIdentityService, ServiceSlotHoldsService]);
    assert.deepEqual(provider(WhatsAppServiceBookingService).inject, [PRISMA_CLIENT, WhatsAppServiceBookingAuthority, ServiceBookingService, ServiceSlotHoldsService]);
    assert.equal(typeof CheckoutWhatsAppConversationAdapter.prototype.respondServiceBooking, "function");
  });
  await t.test("real Nest constructs the actual factories without starting a repository or accepting a public actor", async () => {
    const prisma = Object.freeze({}), identity = Object.freeze({}), booking = Object.freeze({}), holds = Object.freeze({});
    class NativeConstructionModule {}
    Module({ providers: [{ provide: PRISMA_CLIENT, useValue: prisma }, WhatsAppTurnContext,
      { provide: WhatsAppCheckoutIdentityService, useValue: identity }, { provide: ServiceBookingService, useValue: booking }, { provide: ServiceSlotHoldsService, useValue: holds },
      provider(WhatsAppServiceBookingAuthority), provider(WhatsAppServiceBookingService)] })(NativeConstructionModule);
    const context = await NestFactory.createApplicationContext(NativeConstructionModule, { logger: false });
    try { assert.ok(context.get(WhatsAppServiceBookingAuthority) instanceof WhatsAppServiceBookingAuthority);
      assert.ok(context.get(WhatsAppServiceBookingService) instanceof WhatsAppServiceBookingService); assert.equal(context.get(PRISMA_CLIENT), prisma);
    } finally { await context.close(); }
  });
});
