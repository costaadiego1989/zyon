import assert from "node:assert/strict";
import test from "node:test";
import { NotFoundException } from "@nestjs/common";
import { GetStoreConfigUseCase } from "./get-store-config.use-case.js";

test("projects the public store config from the query port", async () => {
  const identifiers: string[] = [];
  const useCase = new GetStoreConfigUseCase({
    findPublicConfig: async (identifier) => {
      identifiers.push(identifier);
      return {
        merchant: {
          id: "merchant_a",
          name: "Loja Exemplo",
          theme: { accentColor: "#112233", textColor: "#000000", backgroundColor: "#ffffff", fontFamily: "Inter", logoUrl: "https://cdn.example/logo.png" },
          storeCategory: "fashion",
          storeSettings: { quick_replies: { stages: [{ stage: "welcome", replies: ["Legado"] }] } },
        },
        subscriptionStatus: "active",
        agentRule: { identity: { agentName: "Lia", greeting: "Olá" }, checkoutSettings: { agentMode: "proactive", initialDelaySeconds: 9 } },
        quickReplies: { welcome: ["Ver novidades"] },
        stories: [{ id: "story_a" }],
      };
    },
  });

  const config = await useCase.execute(" LOJA.EXEMPLO.COM ");
  assert.deepEqual(identifiers, ["loja.exemplo.com"]);
  assert.equal(config.merchantId, "merchant_a");
  assert.equal(config.logo, "https://cdn.example/logo.png");
  assert.equal(config.favicon, "https://cdn.example/logo.png");
  assert.equal(config.agentName, "Lia");
  assert.equal(config.agentGreeting, "Olá");
  assert.deepEqual(config.quickReplies, ["Ver novidades"]);
  assert.equal(config.showBranding, false);
  assert.equal(config.agentMode, "proactive");
  assert.equal(config.agentInitialDelaySeconds, 9);
  assert.deepEqual(config.stories, [{ id: "story_a" }]);
});

test("returns not found only when the query port cannot resolve a public identifier", async () => {
  const useCase = new GetStoreConfigUseCase({ findPublicConfig: async () => null });
  await assert.rejects(() => useCase.execute("missing"), NotFoundException);
});
