import "reflect-metadata";
import { Module, Controller, Get, Req, UseGuards, type INestApplication } from "@nestjs/common";
import { APP_GUARD, APP_INTERCEPTOR, NestFactory, Reflector } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { PRISMA_CLIENT } from "../src/shared/persistence/persistence.module.js";
import { PRISMA_CROSS_MERCHANT_CLIENT } from "../src/shared/persistence/persistence.module.js";
import { AiMeteringService } from "../src/modules/ai-metering/ai-metering.service.js";
import { AiCostsReader } from "../src/modules/ai-metering/ai-costs.reader.js";
import { AiCostsController } from "../src/modules/ai-metering/ai-costs.controller.js";
import { registerTenantMiddleware } from "../src/shared/persistence/tenant.middleware.js";
import { TenantContextService } from "../src/shared/tenant/tenant-context.service.js";
import { TenantGuard } from "../src/shared/tenant/tenant.guard.js";
import { TenantInterceptor } from "../src/shared/tenant/tenant.interceptor.js";
import { REDIS_CLIENT_TOKEN } from "../src/shared/cache/redis.module.js";
import { DOMAIN_EVENT_BUS } from "../src/shared/events/domain-event-bus.port.js";
import { InMemoryDomainEventBus } from "../src/shared/events/in-memory-domain-event-bus.js";
import { OutboxDispatcher } from "../src/shared/messaging/outbox-dispatcher.service.js";
import { PrismaOutboxRepository } from "../src/shared/messaging/infrastructure/prisma-outbox.repository.js";
import { JwtService } from "../src/modules/auth/domain/services/jwt.service.js";
import { AuthCookieService } from "../src/modules/auth/domain/services/auth-cookie.service.js";
import { PrismaAuthRepository } from "../src/modules/auth/infrastructure/prisma-auth.repository.js";
import { AuthGuard } from "../src/modules/auth/presentation/auth.guard.js";
import { PlatformJwtService } from "../src/modules/platform-control/domain/services/platform-jwt.service.js";
import { PrismaPlatformOperatorRepository } from "../src/modules/platform-control/infrastructure/prisma-platform-operator.repository.js";
import { PlatformAccessGuard } from "../src/modules/platform-control/presentation/platform-access.guard.js";
import { PlatformPermissionGuard } from "../src/modules/platform-control/presentation/platform-permission.guard.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "../src/modules/platform-control/presentation/platform-principal.js";
import { SUPPORT_REPOSITORY } from "../src/modules/platform-support/domain/platform-support.js";
import { PlatformSupportService } from "../src/modules/platform-support/application/platform-support.service.js";
import { PrismaPlatformSupportRepository } from "../src/modules/platform-support/infrastructure/prisma-platform-support.repository.js";
import { PlatformSupportRateLimiter } from "../src/modules/platform-support/infrastructure/platform-support-rate-limiter.js";
import { PlatformSupportRelay } from "../src/modules/platform-support/infrastructure/platform-support-relay.js";
import { PlatformSupportGateway } from "../src/modules/platform-support/presentation/platform-support.gateway.js";
import { MerchantPlatformSupportController, OperatorPlatformSupportController } from "../src/modules/platform-support/presentation/platform-support.controller.js";
import { MerchantAiUsageController } from "../src/modules/ai-metering/merchant-ai-usage.controller.js";
import { MerchantAiUsageReader } from "../src/modules/ai-metering/merchant-ai-usage.reader.js";

@Controller("platform/auth")
class FixtureAuthController {
  @Get("me") @UseGuards(PlatformAccessGuard)
  me(@Req() req: PlatformPrincipalRequest) { const p = currentPlatformPrincipal(req); return { operator_id: p.operatorId, email: p.email, role: p.role }; }
}

/** Real PostgreSQL, Redis, identity sessions, guards, controllers and sockets.
 * Only unrelated application modules are omitted from this isolated fixture. */
export async function createSupportFixture(options: { aiMetering?: boolean } = {}) {
  const database = process.env.PLATFORM_SUPPORT_TEST_DATABASE_URL;
  if (!database) throw new Error("PLATFORM_SUPPORT_TEST_DATABASE_URL required");
  const target = new URL(database);
  if (!["localhost", "127.0.0.1"].includes(target.hostname) || !target.pathname.startsWith("/support_test")) throw new Error("support_fixture_requires_isolated_local_database");
  const prisma = new PrismaClient({ datasources: { db: { url: database } } });
  const context = new TenantContextService();
  const wrapped = registerTenantMiddleware(prisma, context) as unknown as PrismaClient;
  const redis = new Redis(process.env.PLATFORM_SUPPORT_TEST_REDIS_URL ?? "redis://127.0.0.1:56439", { maxRetriesPerRequest: 1 });
  const tag = "test_support_" + randomUUID().replaceAll("-", "");
  const auth = new PrismaAuthRepository(wrapped);
  const merchantJwt = new JwtService("support-fixture-merchant-secret-with-more-than-32-characters", 3600, auth);
  const operatorJwt = new PlatformJwtService(new PrismaPlatformOperatorRepository(wrapped), "support-fixture-operator-secret-with-more-than-32-characters", 3600);
  const cookies = new AuthCookieService("aacp_access_token", false);
  const apps: INestApplication[] = [];
  let dispatchTimer: ReturnType<typeof setInterval> | undefined;
  const merchants: Record<string, { id: string; userId: string; token: string }> = {};
  const operators: Record<string, { id: string; token: string; role: string; email: string }> = {};
  async function close() {
    clearInterval(dispatchTimer);
    await Promise.all(apps.map(app => app.close()));
    const merchantIds = Object.values(merchants).map(m => m.id);
    const operatorIds = Object.values(operators).map(o => o.id);
    await prisma.aiUsageEvent.deleteMany({ where: { merchantId: { in: merchantIds } } });
    await prisma.aiVoiceUsageSession.deleteMany({ where: { merchantId: { in: merchantIds } } });
    await prisma.platformSupportTicket.deleteMany({ where: { merchantId: { in: merchantIds } } });
    await prisma.platformAuditEvent.deleteMany({ where: { actorOperatorId: { in: operatorIds } } });
    await prisma.outboxMessage.deleteMany({ where: { merchantId: { in: merchantIds } } });
    await prisma.merchant.deleteMany({ where: { id: { in: merchantIds.filter(id => id.endsWith("_child")) } } });
    await prisma.merchant.deleteMany({ where: { id: { in: merchantIds } } });
    await prisma.platformOperator.deleteMany({ where: { id: { in: operatorIds } } });
    redis.disconnect(); await prisma.$disconnect();
  }
  try {
    await redis.ping();
    for (const plan of ["growth", "scale", "starter179", "other"] as const) {
      const id = `${tag}_${plan}`;
      const { user } = await auth.createMerchantWithOwner({ merchantId: id, merchantName: `Loja ${plan}`, email: `${id}@support.test`, passwordHash: "fixture-only-no-login" });
      const token = await merchantJwt.issue({ userId: user.id, merchantId: id, email: user.email, role: "owner" });
      merchants[plan] = { id, userId: user.id, token };
      await prisma.merchantBillingSubscription.upsert({ where: { merchantId: id }, create: { merchantId: id, planKey: plan === "other" ? "growth" : plan, status: "active" }, update: { planKey: plan === "other" ? "growth" : plan, status: "active" } });
    }
    const childId = `${tag}_child`;
    await prisma.merchant.create({ data: { id: childId, name: "Loja filha Escala", billingAccountMerchantId: merchants.scale!.id } });
    await prisma.merchantTeamMember.create({ data: { merchantId: childId, userId: merchants.scale!.userId, role: "OWNER" } });
    const root = await prisma.merchantUser.findUniqueOrThrow({ where: { id: merchants.scale!.userId } });
    merchants.child = { id: childId, userId: root.id, token: await merchantJwt.issue({ userId: root.id, merchantId: childId, email: root.email, role: "owner" }) };
    for (const [name, role] of [["support", "support_ops"], ["second", "support_ops"], ["admin", "platform_admin"], ["billing", "billing_ops"], ["auditor", "auditor"]] as const) {
      const row = await prisma.platformOperator.create({ data: { email: `${tag}_${name}@support.test`, role } });
      operators[name] = { id: row.id, role, email: row.email, token: await operatorJwt.issue({ operatorId: row.id, email: row.email, role }, 0) };
    }
    const bus = new InMemoryDomainEventBus();
    // The first node owns dispatch; every node owns a Redis subscription.
    const durable = new OutboxDispatcher(new PrismaOutboxRepository(wrapped), bus);
    async function start(port = 0) {
      const localBus = apps.length ? new InMemoryDomainEventBus() : bus;
      class FixtureModule {}
      Module({ controllers: [MerchantPlatformSupportController, OperatorPlatformSupportController, FixtureAuthController, ...(options.aiMetering ? [AiCostsController, MerchantAiUsageController] : [])], providers: [
        { provide: PRISMA_CROSS_MERCHANT_CLIENT, useValue: prisma }, { provide: TenantContextService, useValue: context },
        ...(options.aiMetering ? [AiMeteringService, AiCostsReader, MerchantAiUsageReader] : []),
        { provide: PRISMA_CLIENT, useValue: wrapped }, { provide: REDIS_CLIENT_TOKEN, useValue: redis },
        { provide: DOMAIN_EVENT_BUS, useValue: localBus },
        { provide: JwtService, useValue: merchantJwt }, { provide: PlatformJwtService, useValue: operatorJwt }, { provide: AuthCookieService, useValue: cookies },
        { provide: AuthGuard, useValue: new AuthGuard(merchantJwt, cookies) },
        { provide: PlatformAccessGuard, useValue: new PlatformAccessGuard(operatorJwt) },
        { provide: PlatformPermissionGuard, useValue: new PlatformPermissionGuard(new Reflector()) },
        { provide: APP_GUARD, useValue: new TenantGuard(new Reflector()) },
        { provide: APP_INTERCEPTOR, useValue: new TenantInterceptor(context) },
        { provide: SUPPORT_REPOSITORY, useClass: PrismaPlatformSupportRepository },
        PlatformSupportService, PlatformSupportRateLimiter, PlatformSupportRelay, PlatformSupportGateway,
      ] })(FixtureModule);
      const app = await NestFactory.create(FixtureModule, { logger: process.env.PLATFORM_SUPPORT_DEBUG ? ["error", "debug"] : false });
      app.setGlobalPrefix("v1");
      app.enableCors({ origin: /^http:\/\/(localhost|127\.0\.0\.1):\d+$/, credentials: true });
      await app.listen(port, "127.0.0.1"); apps.push(app);
      return { app, url: await app.getUrl() };
    }
    const first = await start(Number(process.env.PLATFORM_SUPPORT_TEST_PORT ?? 0));
    const second = await start();
    dispatchTimer = setInterval(() => { void durable.dispatch(); }, 100);
    dispatchTimer.unref();
    return { prisma, context, wrapped, redis, tag, merchants, operators, merchantJwt, operatorJwt, first, second, start, async close() { clearInterval(dispatchTimer); await durable.onModuleDestroy(); await close(); } };
  } catch (error) { await close(); throw error; }
}
