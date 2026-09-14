import { describe, expect, it, vi } from "vitest";
import { checkoutSettingsEndpoints } from "./checkout-settings.js";

describe("checkoutSettingsEndpoints", () => {
  it("does not cache the settings shown after a conflict reload", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const api = checkoutSettingsEndpoints("https://api.example", fetchMock as typeof fetch);
    await api.getCheckoutSettings();

    const [, init] = fetchMock.mock.calls[0]!;
    expect(init).toMatchObject({ method: "GET", cache: "no-store" });
  });

  it("reads a fresh ETag before saving checkout settings", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", {
        status: 200,
        headers: { ETag: '"current-settings"' },
      }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const api = checkoutSettingsEndpoints("https://api.example", fetchMock as typeof fetch);
    await api.patchCheckoutSettings({});

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, getInit] = fetchMock.mock.calls[0]!;
    expect(getInit).toMatchObject({ method: "GET", cache: "no-store" });

    const [, putInit] = fetchMock.mock.calls[1]!;
    expect(putInit).toMatchObject({ method: "PUT" });
    expect(new Headers(putInit.headers).get("If-Match")).toBe('"current-settings"');
  });

  it("normalizes a weak ETag before sending If-Match", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("{}", {
        status: 200,
        headers: { ETag: 'W/"current-settings"' },
      }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));

    const api = checkoutSettingsEndpoints("https://api.example", fetchMock as typeof fetch);
    await api.patchCheckoutSettings({});

    const [, putInit] = fetchMock.mock.calls[1]!;
    expect(new Headers(putInit.headers).get("If-Match")).toBe('"current-settings"');
  });
});
