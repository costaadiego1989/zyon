import {
  Global,
  MiddlewareConsumer,
  Module,
  type NestModule,
} from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import type { PrismaClient } from "@prisma/client";
import {
  PersistenceModule,
  PRISMA_CLIENT,
} from "../persistence/persistence.module.js";
import { correlationIdMiddleware } from "./correlation-id.middleware.js";
import { EntityTagService } from "./entity-tag.service.js";
import { HttpClientService } from "./http-client.service.js";
import {
  IDEMPOTENCY_REPOSITORY,
  IdempotencyInterceptor,
} from "./idempotency/idempotency.interceptor.js";
import { PrismaIdempotencyRepository } from "./idempotency/prisma-idempotency.repository.js";
import { NonProductionRouteGuard } from "./non-production-route.guard.js";
import { ProblemDetailsFilter } from "./problem-details.filter.js";
import { RateLimitGuard } from "./rate-limit.guard.js";
import { DistributedRateLimitStore } from "./rate-limit.store.js";
import { WidgetAssetsController } from "./widget-assets.controller.js";
import { MetricsMiddleware } from "./metrics.middleware.js";
import { MetricsController } from "./metrics.controller.js";

@Global()
@Module({
  imports: [PersistenceModule],
  controllers: [WidgetAssetsController, MetricsController],
  providers: [
    {
      provide: HttpClientService,
      useValue: new HttpClientService({ timeout: 15_000, retries: 3 }),
    },
    { provide: APP_GUARD, useClass: NonProductionRouteGuard },
    { provide: DistributedRateLimitStore, useFactory: () => new DistributedRateLimitStore() },
    { provide: APP_GUARD, useClass: RateLimitGuard },
    EntityTagService,
    {
      provide: IDEMPOTENCY_REPOSITORY,
      useFactory: (prisma: PrismaClient) =>
        new PrismaIdempotencyRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: ProblemDetailsFilter },
  ],
  exports: [HttpClientService, EntityTagService],
})
export class HttpModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(correlationIdMiddleware).forRoutes("*");
    consumer.apply(MetricsMiddleware).forRoutes("*");
  }
}
