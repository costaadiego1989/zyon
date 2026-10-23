import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { MetricsService } from "./metrics.service.js";
import { MetricsController } from "./metrics.controller.js";
import { ObservabilityInterceptor } from "./observability.interceptor.js";
import { tracingRuntime } from "./tracing.js";
import { TRACING_RUNTIME, TracingLifecycle } from "./tracing-lifecycle.js";

@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    MetricsService,
    { provide: TRACING_RUNTIME, useValue: tracingRuntime },
    TracingLifecycle,
    {
      provide: APP_INTERCEPTOR,
      useClass: ObservabilityInterceptor,
    },
  ],
  exports: [MetricsService],
})
export class ObservabilityModule {}
