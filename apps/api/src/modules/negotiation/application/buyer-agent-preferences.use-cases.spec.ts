import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GetBuyerAgentPreferencesUseCase,
  UpsertBuyerAgentPreferencesUseCase
} from "./buyer-agent-preferences.use-cases.js";
import { InMemoryNegotiationStore } from "../infrastructure/in-memory-negotiation.store.js";

describe("UpsertBuyerAgentPreferencesUseCase", () => {
  it("isolates buyer preferences by merchant", async () => {
    const store = new InMemoryNegotiationStore();
    const uc = new UpsertBuyerAgentPreferencesUseCase(store);

    await uc.execute({
      merchantId: "m1",
      globalUserId: "g_buyer",
      preferences: {
        enabled: true,
        targetDiscountPercent: 15,
        minimumAcceptableDiscountPercent: 8,
        maxRounds: 2,
        autoAccept: true
      }
    });

    const m1 = await store.getBuyerPreferences("m1", "g_buyer");
    assert.equal(m1?.minimumAcceptableDiscountPercent, 8);

    const m2sameBuyer = await store.getBuyerPreferences("m2", "g_buyer");
    assert.equal(m2sameBuyer, null);

    const prefs = await new GetBuyerAgentPreferencesUseCase(store).executeResolved({
      merchantId: "m2",
      globalUserId: "g_buyer"
    });

    assert.equal(prefs.minimumAcceptableDiscountPercent, 0);
  });
});
