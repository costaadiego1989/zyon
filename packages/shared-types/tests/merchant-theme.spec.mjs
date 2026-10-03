import assert from "node:assert/strict";
import { test } from "node:test";
import { merchantThemeTokens } from "../dist/merchant-theme.js";

const legacyAthom = {
  backgroundColor: "#0A0F0A", textColor: "#F7FAF7", surfaceColor: "#FFFFFF",
  surfaceElevatedColor: "#F8FAFC", mutedTextColor: "#64748B", borderColor: "#D9E2EC",
  accentColor: "#268235", secondaryColor: "#688b5b", fontFamily: "Sora, sans-serif",
  borderRadius: 8, density: "comfortable",
};
const luminance = (hex) => {
  const channels = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
function assertReadable(tokens, mode) {
  for (const surface of ["--aacp-bg", "--aacp-card", "--aacp-header-bg", "--aacp-panel-bg", "--aacp-sheet", "--aacp-inset-bg", "--aacp-surface-elevated"]) {
    const bg = luminance(tokens[surface]);
    assert.equal(bg > 0.179, mode === "light", `${surface} respects ${mode}`);
    for (const text of ["--aacp-fg", "--aacp-muted", "--aacp-faint"]) {
      const fg = luminance(tokens[text]);
      assert.ok((Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) >= 4.5, `${text} on ${surface} meets AA`);
    }
  }
}

test("legacy Athom mixed colors remain readable in SSR and saved light mode", () => {
  const tokens = merchantThemeTokens(legacyAthom);
  assertReadable(tokens, "light");
  assert.equal(tokens["--aacp-card"], "#FFFFFF");
  assert.equal(tokens["--aacp-accent"], legacyAthom.accentColor);
  assert.equal(tokens["--aacp-font"], legacyAthom.fontFamily);
  assert.equal(tokens["--aacp-shell-max-width"], "680px");
});

test("light/dark/grey palettes cannot mix legacy colors after toggling", () => {
  for (const configuredMode of [undefined, "light", "dark", "grey"]) {
    for (const requestedMode of ["light", "dark", "grey"]) {
      assertReadable(merchantThemeTokens({ ...legacyAthom, mode: configuredMode }, requestedMode), requestedMode);
    }
  }
});

test("readable merchant customization is preserved in its configured mode", () => {
  for (const [mode, bg, fg, surface] of [["light", "#f7f8fa", "#111827", "#ffffff"], ["dark", "#0a0f0a", "#f7faf7", "#19251c"]]) {
    const tokens = merchantThemeTokens({ mode, backgroundColor: bg, textColor: fg, surfaceColor: surface });
    assertReadable(tokens, mode);
    assert.equal(tokens["--aacp-bg"], bg);
    assert.equal(tokens["--aacp-fg"], fg);
    assert.equal(tokens["--aacp-card"], surface);
  }
});

test("low-contrast custom text and muted labels fall back to readable ink", () => {
  assertReadable(merchantThemeTokens({ mode: "light", textColor: "#eeeeee", mutedTextColor: "#cccccc" }), "light");
});
