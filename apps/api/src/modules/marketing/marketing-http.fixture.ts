import "reflect-metadata";
import { Global, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { MarketingModule } from "./marketing.module.js";
import { MarketingContactsService } from "./application/marketing-contacts.service.js";
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
} from "../../shared/events/domain-event-bus.port.js";
import { MetricsService } from "../../shared/observability/metrics.service.js";
import { JwtService } from "../auth/domain/services/jwt.service.js";
import { AuthCookieService } from "../auth/domain/services/auth-cookie.service.js";
import { PrismaAuthRepository } from "../auth/infrastructure/prisma-auth.repository.js";
import { marketingTestFixture } from "./marketing-test-fixture.js";

/** Real Nest module, real JWT sessions and PostgreSQL. No provider credentials. */
export async function marketingHttpFixture(port = 0) {
  const url =
    process.env.MARKETING_HTTP_TEST_DATABASE_URL ??
    "postgresql://marketing:marketing-local-only@127.0.0.1:15447/marketing_runtime";
  if (!/^(127\.0\.0\.1|localhost)$/.test(new URL(url).hostname))
    throw new Error("marketing_tests_require_local_database");
  process.env.DATABASE_URL = url;
  process.env.MARKETING_TEST_DATABASE_URL = url;
  process.env.MARKETING_AI_CLASSIFICATION_ENABLED = "false";
  process.env.MARKETING_CAMPAIGN_WORKER_ENABLED = "false";
  process.env.MARKETING_LIFECYCLE_WORKER_ENABLED = "false";
  const fixture = marketingTestFixture();
  const db: PrismaClient = fixture.db;
  const repository = new PrismaAuthRepository(db);
  const jwt = new JwtService(
    `local-marketing-${randomUUID()}`,
    3600,
    repository
  );
  const metrics = new MetricsService();
  const bus: DomainEventBus = {
    publish: async () => {},
    subscribe: () => {},
    handlersFor: () => [],
  };
  @Global()
  @Module({
    providers: [
      { provide: JwtService, useValue: jwt },
      { provide: AuthCookieService, useValue: new AuthCookieService() },
      { provide: MetricsService, useValue: metrics },
      { provide: DOMAIN_EVENT_BUS, useValue: bus },
    ],
    exports: [JwtService, AuthCookieService, MetricsService, DOMAIN_EVENT_BUS],
  })
  class Infrastructure {}
  @Module({ imports: [Infrastructure, MarketingModule] })
  class Runtime {}
  const merchantId = fixture.merchantId;
  await db.merchant.create({
    data: {
      id: merchantId,
      name: "Loja Marketing Local",
      billingAccountMerchantId: merchantId,
      billingSubscription: { create: { planKey: "growth", status: "active" } },
    },
  });
  const users: Record<string, { id: string; token: string }> = {};
  for (const role of ["owner", "admin", "staff"] as const) {
    const user = await db.merchantUser.create({
      data: {
        merchantId,
        email: `${randomUUID()}@marketing.local`,
        role,
        teamMembers: {
          create: {
            merchantId,
            role: role.toUpperCase() as "OWNER" | "ADMIN" | "STAFF",
          },
        },
      },
    });
    users[role] = {
      id: user.id,
      token: await jwt.issue({
        merchantId,
        userId: user.id,
        email: user.email,
        role,
      }),
    };
  }
  const app = await NestFactory.create(Runtime, {
    logger: false,
    abortOnError: false,
  });
  app.setGlobalPrefix("v1");
  app.enableCors({ origin: true, credentials: true });
  await app.listen(port, "127.0.0.1");
  const base = `${await app.getUrl()}/v1/marketing`;
  const request = async (
    path: string,
    options: {
      role?: string | null;
      method?: string;
      body?: unknown;
      token?: string;
    } = {}
  ) => {
    const token =
      options.token ??
      (options.role === null ? null : users[options.role ?? "owner"].token);
    return fetch(`${base}${path}`, {
      method: options.method ?? "GET",
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "Content-Type": "application/json",
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
  };
  return {
    ...fixture,
    app,
    base,
    users,
    jwt,
    metrics,
    request,
    contacts: app.get(MarketingContactsService),
    cleanup: async () => {
      await app.close();
      metrics.registry.clear();
      await db.merchant.delete({ where: { id: merchantId } });
      await fixture.cleanup();
    },
  };
}
