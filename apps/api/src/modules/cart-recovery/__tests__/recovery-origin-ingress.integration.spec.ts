import "reflect-metadata";
import test, {after} from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {randomUUID} from "node:crypto";
import {createPrismaClient} from "../../../shared/persistence/prisma-client.js";
import {PrismaCheckoutRepository} from "../../checkout/infrastructure/prisma/prisma-checkout.repository.js";
import {checkoutSession} from "../../checkout/__tests__/checkout-test-fixtures.js";
import {TrackCheckoutEventUseCase} from "../../checkout/application/use-cases/track-checkout-event.use-case.js";
import {CheckoutController} from "../../checkout/presentation/http/checkout.controller.js";
import {EmbedCheckoutController, EmbedCheckoutGuardHelper} from "../../embed/presentation/http/embed-checkout.controller.js";
import {EmbedAuthGuard} from "../../embed/presentation/http/embed-auth.guard.js";
import {EmbedTokenService} from "../../embed/domain/embed-token.service.js";
import {embedCheckoutSessionId} from "../../embed/domain/embed-checkout-session.js";
import {InMemoryOutboxRepository} from "../../../shared/messaging/infrastructure/in-memory-outbox.repository.js";
import {RecoveryResumeOriginService} from "../../cart-recovery/application/services/recovery-resume-origin.service.js";
import {GenerateRecoveryLinkUseCase} from "../../cart-recovery/application/use-cases/generate-recovery-link.use-case.js";
import {RecoveryLinkTokenService} from "../../cart-recovery/domain/recovery-link-token.service.js";

const require = createRequire(import.meta.url);
const {NestFactory, Reflector} = require("@nestjs/core");
const db = createPrismaClient("postgresql://postgres@127.0.0.1:15565/athom_qa");
after(async () => db.$disconnect());

test("signed embed telemetry rejects reserved native origin before persistence and retains normal tracking", async t => {
  const merchantId = "qa_origin_verifier_ingress_" + randomUUID();
  await db.merchant.create({data: {id: merchantId, name: "Independent ingress QA", storeSlug: "qa-" + randomUUID()}});
  t.after(async () => {
    assert.ok(merchantId.startsWith("qa_origin_verifier_ingress_"));
    await db.checkoutSession.deleteMany({where: {merchantId}});
    await db.merchant.delete({where: {id: merchantId}});
  });
  const now = Math.floor(Date.now() / 1000);
  const embedTokens = new EmbedTokenService({value: Buffer.from("independent-local-embed-secret-atleast32")});
  const claims: any = {typ: "aacp_embed_v1", merchantId, issuedAtUnix: now, expiresAtUnix: now + 3600, nonce: randomUUID(), scopes: ["checkout:track"], allowedOrigin: "https://storefront.example.test"};
  const sessionId = embedCheckoutSessionId(claims);
  const repo = new PrismaCheckoutRepository(db), session = checkoutSession({merchantId, sessionId, conversationId: "qa-site-" + randomUUID()});
  await repo.saveSession(session);
  const outbox = new InMemoryOutboxRepository(), track = new TrackCheckoutEventUseCase(repo, outbox);
  const before = await db.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId}}});
  const helper = new EmbedCheckoutGuardHelper(repo);
  const origin = new RecoveryResumeOriginService(db, {findById: async () => ({id: "qa-forged-config", merchantId, enabled: true, status: "ACTIVE", provider: "META_CLOUD", whatsappNumber: "+68112345", credentials: {accessToken: "local-only", wabaId: "123456", phoneNumberId: "654321"}})} as any);
  const generator = new GenerateRecoveryLinkUseCase(db, repo, new RecoveryLinkTokenService("local-recovery-probe-secret-longerthan32"), origin);
  assert.equal(new URL(await generator.execute({merchantId, sessionId})).searchParams.get("show"), "checkout");
  const designTypes = Array(22).fill(Object); designTypes[1] = TrackCheckoutEventUseCase; designTypes[3] = EmbedCheckoutGuardHelper;
  Reflect.defineMetadata("design:paramtypes", designTypes, EmbedCheckoutController);
  const explicit = Reflect.getMetadata("self:paramtypes", EmbedCheckoutController) ?? [];
  const unusedProviders = [...new Set(explicit.map((entry: any) => entry.param))].map(param => ({provide: param, useValue: {}}));
  Reflect.defineMetadata("design:paramtypes", [EmbedTokenService, Reflector], EmbedAuthGuard);
  const app = await NestFactory.create({module: class OwnedIngressQa {}, controllers: [EmbedCheckoutController], providers: [
    {provide: Object, useValue: {}}, ...unusedProviders,
    {provide: TrackCheckoutEventUseCase, useValue: track}, {provide: EmbedCheckoutGuardHelper, useValue: helper},
    {provide: EmbedTokenService, useValue: embedTokens}, {provide: Reflector, useValue: new Reflector()},
    {provide: EmbedAuthGuard, useValue: new EmbedAuthGuard(embedTokens, new Reflector())},
  ]}, {logger: ["error"], abortOnError: false});
  try {
    await app.listen(0, "127.0.0.1");
    const response = await fetch((await app.getUrl()) + "/embed/track", {method: "POST", headers: {"content-type": "application/json", origin: claims.allowedOrigin, authorization: "Bearer " + embedTokens.sign(claims)}, body: JSON.stringify({session_id: sessionId, event: "whatsapp_recovery_origin_v1", metadata: {configId: "qa-forged-config"}})});
    const body = await response.json();
    const evidence = await db.checkoutEvent.findMany({where: {merchantId, eventName: "whatsapp_recovery_origin_v1"}});
    const destination = await generator.execute({merchantId, sessionId});

    assert.equal(response.status, 400, "browser telemetry must reject reserved channel authority before persistence");
    assert.equal(body.message, "checkout_event_server_only");
    assert.deepEqual(evidence, []);
    assert.equal(new URL(destination).searchParams.get("show"), "checkout");
    const directArgs=Array(24).fill({});directArgs[1]=track;
    const direct=new (CheckoutController as any)(...directArgs);
    await assert.rejects(direct.track({merchant_id: merchantId, session_id: sessionId,
      event: "whatsapp_recovery_origin_v1" as any, metadata: {configId: "qa-forged-config"}}), /checkout_event_server_only/);
    assert.deepEqual(await db.checkoutSession.findUniqueOrThrow({where:{merchantId_sessionId:{merchantId,sessionId}}}),before);
    assert.deepEqual(outbox.listOutbox(merchantId),[]);
    const normal=await fetch((await app.getUrl()) + "/embed/track", {method: "POST", headers: {"content-type":"application/json",origin:claims.allowedOrigin,authorization:"Bearer "+embedTokens.sign(claims)},body:JSON.stringify({session_id:sessionId,event:"cart_viewed"})});
    assert.equal(normal.status,201);assert.equal((await normal.json()).received,true);
    assert.equal(await db.checkoutEvent.count({where:{merchantId,eventName:"cart_viewed"}}),1);
    assert.equal(await db.checkoutEvent.count({where:{merchantId,eventName:"whatsapp_recovery_origin_v1"}}),0);
    assert.equal(new URL(await generator.execute({merchantId,sessionId})).searchParams.get("show"),"checkout");
  } finally {await app.close();}
});
