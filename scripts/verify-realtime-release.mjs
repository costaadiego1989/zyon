import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const requiredSource = [
  ["apps/api/src/shared/openai/openai-realtime-voice.service.ts", [
    "/realtime/client_secrets",
    "gpt-realtime-2.1-mini",
    "add_item_to_cart",
    "begin_checkout",
  ]],
  ["apps/api/src/modules/storefront/presentation/http/storefront-realtime-voice.controller.ts", ["realtime/session"]],
  ["apps/api/src/modules/embed/presentation/http/embed-realtime-voice.controller.ts", ["Controller(\"embed/realtime\")", "@Post(\"session\")"]],
  ["apps/widget_v2/src/lib/voice/use-realtime-voice-checkout.ts", ["RTCPeerConnection", "realtime/calls"]],
  ["apps/widget_v2/src/api/checkout-session.ts", ["embed/realtime/session", "embedBaseUrl"]],
  ["apps/storefront/src/components/CheckoutPanel.tsx", ["embedApiBaseUrl=\"/api\""]],
  ["apps/storefront/src/components/conversation/RealtimeVoiceComposer.tsx", ["Ativar"]],
];

const failures = [];
for (const [relativePath, fragments] of requiredSource) {
  let content = "";
  try {
    content = readFileSync(resolve(relativePath), "utf8");
  } catch {
    failures.push(`${relativePath}: arquivo ausente`);
    continue;
  }
  for (const fragment of fragments) {
    if (!content.includes(fragment)) failures.push(`${relativePath}: falta ${JSON.stringify(fragment)}`);
  }
}

if (failures.length > 0) {
  console.error("Realtime release guard failed:\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("Realtime release guard passed: API, secure proxy, WebRTC client and commerce tools are present.");
