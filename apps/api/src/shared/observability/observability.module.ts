import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { MetricsService } from "./metrics.service.js";
import { MetricsController } from "./metrics.controller.js";
import { ObservabilityInterceptor } from "./observability.interceptor.js";

@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ObservabilityInterceptor,
    },
  ],
  exports: [MetricsService],
})
export class ObservabilityModule {}
