import { Global, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { LoggerModule as NestPinoLoggerModule } from "nestjs-pino";
import { CorrelationIdMiddleware } from "./correlation-id.middleware.js";
import { CorrelationIdStorage } from "./correlation-id.storage.js";

import { createHttpLoggerOptions } from "./http-logger.config.js";

@Global()
@Module({
  imports: [
    NestPinoLoggerModule.forRootAsync({
      useFactory: () => ({
        pinoHttp: createHttpLoggerOptions(),
      }),
    }),
  ],
  providers: [CorrelationIdStorage, CorrelationIdMiddleware],
  exports: [CorrelationIdStorage, NestPinoLoggerModule],
})
export class LoggerModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Apply before any route so downstream handlers, interceptors and
    // guards all run inside the correlation-id AsyncLocalStorage frame.
    consumer.apply(CorrelationIdMiddleware).forRoutes("*");
  }
}
