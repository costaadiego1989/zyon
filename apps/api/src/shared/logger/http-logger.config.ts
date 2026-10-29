import type { Options } from "pino-http";
import { REDACTED_LOG_PATHS } from "./log-redaction.js";
import { logContext, mergeLogContext, requestLogId, safeErrorMetadata, safeHttpMethod } from "./log-context.js";

/** Single configuration for the active AppModule and the compatibility wrapper. */
export function createHttpLoggerOptions(env: NodeJS.ProcessEnv = process.env): Options {
  const production = env.NODE_ENV === "production";
  const allowedLevels = new Set(["trace", "debug", "info", "warn", "error", "fatal", "silent"]);
  return {
    level: env.LOG_LEVEL && allowedLevels.has(env.LOG_LEVEL) ? env.LOG_LEVEL : production ? "info" : "debug",
    autoLogging: true, quietReqLogger: true, wrapSerializers: false,
    genReqId: req => requestLogId(req),
    customProps: req => ({ requestId: requestLogId(req) }),
    // Evaluated for each service log, not just when the HTTP child logger is created.
    mixin: () => logContext(),
    mixinMergeStrategy: (value, ambient) => mergeLogContext(value, ambient),
    serializers: {
      req: req => ({ method: safeHttpMethod(req?.method) }),
      res: res => ({ statusCode: Number.isInteger(res?.statusCode) && res.statusCode >= 100 && res.statusCode <= 599 ? res.statusCode : 500 }),
      err: error => safeErrorMetadata(error),
    },
    customErrorMessage: () => "request.failed",
    customSuccessMessage: () => "request.completed",
    redact: { paths: [...REDACTED_LOG_PATHS, "password", "secret", "token", "access_token", "buyer_access_token", "correlationId", "correlation_id", "*.password", "*.secret", "*.token"], censor: "[redacted]" },
    timestamp: () => `,"time":"${new Date().toISOString()}"`,
    transport: production ? undefined : { target: "pino-pretty", options: { colorize: true, singleLine: true } },
  };
}

