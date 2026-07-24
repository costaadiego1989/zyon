import "reflect-metadata";
import { config as loadDotenv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { E2eAppModule } from "./e2e-app.module.js";
import { resolveCorsConfig } from "./shared/config/cors-config.js";
import { resolveSecurityHeaders } from "./shared/config/security-headers-config.js";
import { configureApiDocumentation } from "./shared/http/api-documentation.js";
import { apiVersioningMiddleware } from "./shared/http/api-versioning.js";
import {
  assertRequiredSecretsInProduction,
  resolveProductionRequiredSecrets,
} from "./shared/config/secret-config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
loadDotenv({ path: resolve(__dirname, "../.env") });
loadDotenv({ path: resolve(__dirname, "../../../.env"), override: false });

async function bootstrap() {
  assertRequiredSecretsInProduction(resolveProductionRequiredSecrets());

  // AppModule is production-pure. Non-production runs that need the seed +
  // coupon/cross-sell admin routes boot the e2e composition root instead.
  const useE2eComposition =
    process.env.E2E_SEED_ENABLED === "true" && process.env.NODE_ENV !== "production";
  const rootModule = useE2eComposition ? E2eAppModule : AppModule;

  const app = await NestFactory.create(rootModule, { rawBody: true });
  configureTrustProxy(app);
  app.enableCors(resolveCorsConfig());
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
  configureApiDocumentation(app);

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
