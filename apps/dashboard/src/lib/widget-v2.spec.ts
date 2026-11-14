import { afterEach, describe, expect, it, vi } from "vitest";
import { widgetV2Snippet } from "./widget-v2.js";

afterEach(() => vi.unstubAllEnvs());

describe("official widget installation", () => {
  it("uses the configured widget and preserves the checkout parameters", () => {
    vi.stubEnv("VITE_WIDGET_V2_URL", "https://widget.zyon-payments.com.br/");
    const snippet = widgetV2Snippet({ apiBaseUrl: "https://api.zyon-payments.com.br/", merchantId: "merchant&1", token: "temporary.token", cartRef: "cart/1" });
    const src = snippet.match(/src="([^"]+)"/)![1].replace(/&amp;/g, "&");
    const url = new URL(src);
    expect(url.origin).toBe("https://widget.zyon-payments.com.br");
    expect(url.searchParams.get("merchantId")).toBe("merchant&1");
    expect(url.searchParams.get("embedToken")).toBe("temporary.token");
    expect(url.searchParams.get("cartRef")).toBe("cart/1");
    expect(url.searchParams.get("apiBaseUrl")).toBe("https://api.zyon-payments.com.br");
    expect(snippet).toContain('referrerpolicy="no-referrer"');
    expect(snippet).not.toContain("/widget/aacp.js");
  });
});
