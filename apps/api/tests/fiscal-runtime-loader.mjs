import { load as metadataLoad } from "./platform-support-loader.mjs";
import { load as unitLoad, resolve as unitResolve } from "./ready-prod-loader.mjs";
import fs from "node:fs";

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && context.parentURL.includes("/apps/widget_v2/src/")) {
    const url = new URL(specifier, context.parentURL);
    for (const suffix of [".ts", ".tsx"]) {
      const candidate = new URL(url.href + suffix);
      if (fs.existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
    }
  }
  return unitResolve(specifier, context, nextResolve);
}

// These are actual Nest-injected HTTP entry points, controllers and guards in
// the fiscal fixtures. Preserve their constructor metadata as in production.
// The remaining collaborators are explicitly constructed by those fixtures;
// use the existing unit loader so interface-only imports stay type-only.
// This selective fixture loader is not a proof of full AppModule bootstrap.
const injected = [
  "/apps/api/src/modules/fiscal/presentation/fiscal-checkout.controller.ts",
  "/apps/api/src/modules/payment/presentation/http/payment.controller.ts",
  "/apps/api/src/modules/embed/presentation/http/embed-auth.guard.ts",
  "/apps/api/src/modules/checkout/presentation/http/checkout.controller.ts",
  "/apps/api/tests/fiscal-signed-payment.fixture.ts",
  "/apps/api/tests/fiscal-buyer-browser-server.ts",
  "/apps/api/src/modules/fiscal/presentation/buyer-fiscal.controller.ts",
  "/apps/api/src/modules/buyer-account/presentation/http/buyer-jwt-auth.guard.ts",
  "/apps/api/tests/fixtures/fiscal-runner-success.fixture.ts",
  "/apps/api/src/modules/auth/presentation/auth.guard.ts",
  "/apps/api/src/modules/auth/presentation/tenant-role.guard.ts",
  "/apps/api/src/modules/whatsapp-channel/presentation/http/whatsapp-webhook.controller.ts",
  "/apps/api/src/modules/inventory/presentation/http/marketplace-webhook.controller.ts",
  "/apps/api/src/shared/tenant/tenant.interceptor.ts",
];

export function load(url, context, nextLoad) {
  const fiscalController = url.includes("/apps/api/src/modules/fiscal/presentation/") && url.endsWith(".controller.ts");
  return (fiscalController || injected.some(path => url.endsWith(path)))
    ? metadataLoad(url, context, nextLoad) : unitLoad(url, context, nextLoad);
}
