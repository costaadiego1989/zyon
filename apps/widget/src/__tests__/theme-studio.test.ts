import { describe, expect, it } from "vitest";
import {
  canUseThemeStudio,
  isLocalThemeStudioHost,
  isMerchantSession,
  mergeThemeLayers,
  THEME_PRESETS
} from "../lib/theme-studio.js";
import { DEFAULT_MERCHANT_THEME } from "@zyon/shared-types";

const merchantSession = {
  merchant_id: "mrc_1",
  access_token: "tok",
  email: "a@b.com",
  token_type: "Bearer" as const,
  expires_in: 3600,
  provider: "password" as const
};

describe("theme-studio", () => {
  it("mergeThemeLayers applies draft over base", () => {
    const merged = mergeThemeLayers(
      { ...DEFAULT_MERCHANT_THEME, accentColor: "#111111" },
      {},
      { accentColor: "#222222" }
    );
    expect(merged.accentColor).toBe("#222222");
  });

  it("isMerchantSession rejects buyer sessions", () => {
    expect(
      isMerchantSession({
        ...merchantSession,
        global_user_id: "buyer_1"
      })
    ).toBe(false);
  });

  it("canUseThemeStudio is true for merchant session", () => {
    expect(canUseThemeStudio(merchantSession)).toBe(true);
    expect(canUseThemeStudio({ ...merchantSession, global_user_id: "buyer_1" })).toBe(false);
  });

  it("canUseThemeStudio is true on local host without merchant session", () => {
    expect(isLocalThemeStudioHost()).toBe(true);
    expect(canUseThemeStudio(null)).toBe(true);
  });

  it("exposes enterprise presets", () => {
    expect(THEME_PRESETS.map((preset) => preset.id)).toEqual([
      "stripe-clean",
      "concierge",
      "bold-retail"
    ]);
  });
});
