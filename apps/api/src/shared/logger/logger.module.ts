import { Global, MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { LoggerModule as NestPinoLoggerModule } from "nestjs-pino";
import { randomUUID } from "node:crypto";
import { CorrelationIdMiddleware } from "./correlation-id.middleware.js";
import { CorrelationIdStorage } from "./correlation-id.storage.js";

const isProduction = process.env.NODE_ENV === "production";

@Global()
@Module({
  imports: [
    NestPinoLoggerModule.forRootAsync({
      useFactory: () => ({
        pinoHttp: {
          level: process.env.LOG_LEVEL ?? (isProduction ? "info" : "debug"),
          autoLogging: true,
          quietReqLogger: true,
          genReqId: (req, res) => {
            // pino-http exposes the correlation id under the standard
            // `req.id` slot, while our own middleware also surfaces it via
            // `req.correlationId` and the `x-correlation-id` response header.
            const correlationId =
              CorrelationIdStorage.get() ?? randomUUID();
            res.setHeader("x-correlation-id", correlationId);
            return correlationId;
          },
          customProps: () => ({
            correlationId: CorrelationIdStorage.get(),
          }),
          formatters: {
            level: (label) => ({ level: label }),
          },
          timestamp: () => `,"time":"${new Date().toISOString()}"`,
          redact: {
            paths: [
              "req.headers.authorization",
              "req.headers.cookie",
              "req.headers['x-api-key']",
              "*.password",
              "*.secret",
              "*.token",
            ],
            remove: true,
          },
          transport: isProduction
            ? undefined
            : {
                target: "pino-pretty",
                options: {
                  colorize: true,
                  singleLine: true,
                  translateTime: "SYS:HH:MM:ss.l",
                  ignore: "pid,hostname",
                },
              },
        },
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