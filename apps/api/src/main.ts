import { initTracing } from "./shared/observability/tracing.js";
initTracing();

import "reflect-metadata";
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory, Reflector } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { E2eAppModule } from "./e2e-app.module.js";
import { resolveSecurityHeaders } from "./shared/config/security-headers-config.js";
import { configureApiDocumentation } from "./shared/http/api-documentation.js";
import { apiVersioningMiddleware } from "./shared/http/api-versioning.js";
import { initMetrics, initDomainMetrics } from "./shared/http/metrics.middleware.js";
import {
  assertRequiredSecretsInProduction,
  resolveProductionRequiredSecrets,
} from "./shared/config/secret-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadDotenv({ path: resolve(__dirname, "../.env") });
loadDotenv({ path: resolve(__dirname, "../../../.env"), override: false });

async function bootstrap() {
  initMetrics();
  initDomainMetrics();

  assertRequiredSecretsInProduction(resolveProductionRequiredSecrets());

  const useE2eComposition =
    process.env.E2E_SEED_ENABLED === "true" && process.env.NODE_ENV !== "production";
  const rootModule = useE2eComposition ? E2eAppModule : AppModule;

  const app = await NestFactory.create<NestExpressApplication>(rootModule, {
    rawBody: true,
    bodyParser: true,
  });
  app.useBodyParser("json", { limit: "5mb" });
  app.useBodyParser("urlencoded", { extended: true, limit: "5mb" });
  configureTrustProxy(app);

  if (process.env.NODE_ENV !== "production") {
    app.enableCors({
      origin: true,
      credentials: true,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization", "X-Internal-Service-Token", "X-Merchant-Id", "Idempotency-Key", "If-Match", "If-None-Match", "Cookie"],
    });
  }

  // Serve the built checkout widget bundle at /widget/* so the dashboard theme
  // live-preview iframe (and self-hosted embeds, per test-embed.html) can load
  // widget.css + the IIFE bundle. `/widget/aacp.js` is aliased to the real
  // artifact `aacp-checkout-widget.iife.js` (IIFE works in the sandboxed iframe
  // and on partner pages without ESM). Dev-safe: missing dist → 404, never crash.
  try {
    const { existsSync } = await import("node:fs");
    const here = dirname(fileURLToPath(import.meta.url)); // apps/api/dist
    const widgetDist = resolve(here, "../../widget/dist");
    const iifePath = resolve(widgetDist, "aacp-checkout-widget.iife.js");
    if (existsSync(widgetDist)) {
      // Alias must be registered before the static mount so it wins for /widget/aacp.js.
      app.getHttpAdapter().get("/widget/aacp.js", (_req: unknown, res: any) => {
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        res.setHeader("Content-Type", "application/javascript; charset=utf-8");
        if (existsSync(iifePath)) return res.sendFile(iifePath);
        return res.status(404).send("// widget bundle not built: run `pnpm --filter widget build`");
      });
      app.useStaticAssets(widgetDist, {
        prefix: "/widget",
        setHeaders: (res: { setHeader(n: string, v: string): void }) => {
          res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
        },
      });
    } else {
      console.warn(`[widget] dist not found at ${widgetDist} — /widget/* disabled. Run \`pnpm --filter widget build\`.`);
    }
  } catch (err) {
    console.warn(`[widget] failed to mount /widget static assets: ${err instanceof Error ? err.message : String(err)}`);
  }

  app.use(apiVersioningMiddleware);

  const securityHeaders = resolveSecurityHeaders();
  app.use((_req: unknown, res: { setHeader(name: string, value: string): void }, next: () => void) => {
    for (const [name, value] of Object.entries(securityHeaders)) {
      res.setHeader(name, value);
    }
    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  );
  app.useGlobalInterceptors(new (await import("./shared/http/request-timeout.interceptor.js")).RequestTimeoutInterceptor(app.get(Reflector)));
  if (process.env.NODE_ENV !== "production" || process.env.ENABLE_DOCS === "true") {
    configureApiDocumentation(app);
  }

  app.enableShutdownHooks();

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  console.log(`AI Checkout API listening on http://localhost:${port}`);
  console.log(`OpenAPI reference available at http://localhost:${port}/docs`);
  console.log(`DeepSeek key loaded: ${Boolean(process.env.DEEPSEEK_API_KEY)}`);
  console.log(`OpenAI key loaded: ${Boolean(process.env.OPENAI_API_KEY)}`);
}

function configureTrustProxy(app: { getHttpAdapter(): { getInstance(): { set(name: string, value: unknown): void } } }): void {
  const hops = trustedProxyHops();
  if (hops > 0) app.getHttpAdapter().getInstance().set("trust proxy", hops);
}

function trustedProxyHops(): number {
  const raw = process.env.TRUST_PROXY_HOPS?.trim();
  if (!raw) return 0;
  const hops = Number(raw);
  return Number.isInteger(hops) && hops > 0 ? hops : 0;
}

void bootstrap();
