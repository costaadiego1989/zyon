import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BuyerAgentNegotiationPreferencesController } from "./buyer-agent-negotiation-preferences.controller.js";
import {
  GetBuyerAgentPreferencesUseCase,
  UpsertBuyerAgentPreferencesUseCase
} from "../../application/buyer-agent-preferences.use-cases.js";
import { InMemoryNegotiationStore } from "../../infrastructure/in-memory-negotiation.store.js";

const OWNER = { user: { merchantId: "m_owner", userId: "u", email: "e", role: "owner" } };

describe("BuyerAgentNegotiationPreferencesController", () => {
  it("scopes upsert to JWT merchant (ignores body merchantId)", async () => {
    const store = new InMemoryNegotiationStore();
    const getPrefs = new GetBuyerAgentPreferencesUseCase(store);
    const upsert = new UpsertBuyerAgentPreferencesUseCase(store);
    const c = new BuyerAgentNegotiationPreferencesController(getPrefs, upsert);

    await c.put(
      OWNER,
      "buyer_1",
      {
        enabled: true,
        minimumAcceptableDiscountPercent: 5,
        targetDiscountPercent: 10,
        maxRounds: 3,
        autoAccept: false,
        requireHumanConfirmationAbove: 500_00
      }
    );

    const stored = await store.getBuyerPreferences("m_owner", "buyer_1");
    assert.ok(stored, "prefs must be stored under JWT merchant");

    const other = await store.getBuyerPreferences("m_other", "buyer_1");
    assert.equal(other, null, "must not bleed to other tenant");
  });

  // Bug 8 regression: GET must issue exactly one DB read, not two
  it("[Bug 8] GET preferences hits store exactly once (no duplicate reads)", async () => {
    const store = new InMemoryNegotiationStore();
    let readCount = 0;
    const origGet = store.getBuyerPreferences.bind(store);
    store.getBuyerPreferences = async (merchantId: string, globalUserId: string) => {
      readCount++;
      return origGet(merchantId, globalUserId);
    };

    const getPrefs = new GetBuyerAgentPreferencesUseCase(store);
    const upsert = new UpsertBuyerAgentPreferencesUseCase(store);
    const c = new BuyerAgentNegotiationPreferencesController(getPrefs, upsert);

    // GET with no stored prefs → default returned, has_custom_preferences=false, single read
    readCount = 0;
    const res1 = await c.get(OWNER, "buyer_42");
    assert.equal(readCount, 1, "GET without stored prefs must read store exactly once");
    assert.equal(res1.has_custom_preferences, false);
    assert.ok(res1.preferences, "resolved preferences must be returned");

    // Seed prefs, then GET again
    await store.upsertBuyerPreferences("m_owner", "buyer_42", {
      enabled: true,
      minimumAcceptableDiscountPercent: 3,
      targetDiscountPercent: 8,
      maxRounds: 3,
      autoAccept: false,
      requireHumanConfirmationAbove: 200_00
    });

    readCount = 0;
    const res2 = await c.get(OWNER, "buyer_42");
    assert.equal(readCount, 1, "GET with stored prefs must read store exactly once");
    assert.equal(res2.has_custom_preferences, true);
    assert.equal(res2.preferences.targetDiscountPercent, 8);
  });

  // Bug 8 regression: GET without global_user_id must not hit store at all
  it("[Bug 8] GET preferences with no global_user_id skips store entirely", async () => {
    const store = new InMemoryNegotiationStore();
    let readCount = 0;
    const origGet = store.getBuyerPreferences.bind(store);
    store.getBuyerPreferences = async (merchantId: string, globalUserId: string) => {
      readCount++;
      return origGet(merchantId, globalUserId);
    };

    const getPrefs = new GetBuyerAgentPreferencesUseCase(store);
    const upsert = new UpsertBuyerAgentPreferencesUseCase(store);
    const c = new BuyerAgentNegotiationPreferencesController(getPrefs, upsert);

    readCount = 0;
    const res = await c.get(OWNER, undefined);
    assert.equal(readCount, 0, "GET with no global_user_id must not hit store");
    assert.equal(res.has_custom_preferences, false);
    assert.ok(res.preferences, "resolved default preferences must be returned");
  });
});
