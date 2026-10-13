import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Deterministic navigation and commerce regressions; provider sends are mocked.
// Real persistence is validated separately by validate-whatsapp-storefront-parity.cjs in sandbox.
const specs = [
  "whatsapp-channel/domain/ui/meta-ui-renderer.spec.ts",
  "whatsapp-channel/domain/ui/meta-store-actions.spec.ts",
  "whatsapp-channel/domain/ui/meta-flow.spec.ts",
  "whatsapp-channel/application/use-cases/handle-meta-conversation.spec.ts",
  "whatsapp-channel/application/services/meta-native-assets.spec.ts",
  "whatsapp-channel/application/services/whatsapp-checkout-identity.spec.ts",
  "buyer-account/infrastructure/prisma-buyer-phone-lookup.spec.ts",
  "whatsapp-channel/infrastructure/adapters/whatsapp-storefront-parity.spec.ts",
  "whatsapp-channel/infrastructure/adapters/checkout-whatsapp-conversation.adapter.spec.ts",
  "whatsapp-channel/infrastructure/adapters/meta-cloud-sender.adapter.spec.ts",
  "whatsapp-channel/infrastructure/adapters/meta-catalog-order.adapter.spec.ts",
  "whatsapp-templates/infrastructure/adapters/meta-cloud-template.adapter.spec.ts",
  "whatsapp-templates/infrastructure/adapters/whatsapp-template-sender.adapter.spec.ts",
  "whatsapp-templates/application/use-cases/recovery-template-lifecycle.spec.ts",
  "whatsapp-templates/domain/catalog/template-catalog.spec.ts",
  "post-sale/application/services/post-sale-ai-copywriter.meta.spec.ts",
  "checkout/application/services/otp.service.spec.ts",
  "checkout/__tests__/checkout-trust-boundary.spec.ts",
  "checkout/__tests__/checkout-customer-correction.spec.ts",
  "checkout/__tests__/send-chat-message.use-case.spec.ts",
  "storefront/infrastructure/tool-handlers/commerce-rules-flow.spec.ts",
  "storefront/infrastructure/agents/storefront-ui-action.executor.spec.ts",
].map(path => `./src/modules/${path}`);
specs.push("./src/shared/crypto/pii-cipher.service.spec.ts");

const result = spawnSync(process.execPath, ["--loader", "./tests/ready-prod-loader.mjs", "--test", "--test-force-exit", ...specs], {
  cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "inherit", env: process.env,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
