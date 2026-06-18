/**
 * Regression tests for use-global-auth bugs documented in ADR 0003.
 *
 * P1: verifyPhoneCode must pass merchantId to parseBuyerAuthPayload so the
 *     persisted session carries merchant_id (account hub depends on it).
 * P2: submit() must catch network errors and set user-facing error state.
 * P2: safeReadSession must reject sessions without expires_at or past expiry.
 * P2: loginFromCheckoutSession must treat expired tokens as absent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useGlobalAuth } from "../hooks/use-global-auth.js";

const STORAGE_KEY = "aacp_global_auth_session";

function buildBuyerPayload() {
  return {
    globalUserId: "gu_123",
    email: "buyer@example.com",
    accessToken: "tok_abc",
    tokenType: "Bearer" as const,
    expiresIn: 3600
  };
}

describe("useGlobalAuth — ADR 0003 regressions", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    localStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function jsonOk(body: unknown) {
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
  }

  function jsonErr(body: unknown, status = 400) {
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" }
      })
    );
  }

  // ── P1: verifyPhoneCode must stamp merchant_id ────────────────────────────

  it("P1: verifyPhoneCode persiste merchant_id na sessão (account hub depende disso)", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk(buildBuyerPayload()));

    const { result } = renderHook(() =>
      useGlobalAuth({ apiBaseUrl: "http://localhost:3009", merchantId: "mrc_test" })
    );

    let ok = false;
    await act(async () => {
      ok = await result.current.verifyPhoneCode("11999999999", "123456");
    });

    expect(ok).toBe(true);
    expect(result.current.session?.merchant_id).toBe("mrc_test");

    // Also verify the persisted value in localStorage carries merchant_id.
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.merchant_id).toBe("mrc_test");
  });

  it("P1: verifyPhoneCode sem merchantId configurado → session sem merchant_id (guard: hub não abre)", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk(buildBuyerPayload()));

    const { result } = renderHook(() =>
      useGlobalAuth({ apiBaseUrl: "http://localhost:3009" })
      // No merchantId passed
    );

    await act(async () => {
      await result.current.verifyPhoneCode("11999999999", "123456");
    });

    expect(result.current.session?.merchant_id).toBeUndefined();
  });

  // ── P2: submit() must catch network errors ────────────────────────────────

  it("P2: submit() com erro de rede → seta error (não falha silenciosamente)", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() =>
      useGlobalAuth({ apiBaseUrl: "http://localhost:3009", merchantId: "mrc_test" })
    );

    await act(async () => {
      result.current.setEmail("test@example.com");
      result.current.setPassword("pass1234");
    });

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.error).toMatch(/rede/i);
    expect(result.current.loading).toBe(false);
  });

  it("P2: submit() com erro de rede no register → seta error", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));

    const { result } = renderHook(() =>
      useGlobalAuth({ apiBaseUrl: "http://localhost:3009", merchantId: "mrc_test" })
    );

    await act(async () => {
      result.current.setMode("register");
      result.current.setEmail("test@example.com");
      result.current.setPassword("pass1234");
      result.current.setMerchantName("Loja Teste");
    });

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.error).toMatch(/rede/i);
    expect(result.current.loading).toBe(false);
  });

  // ── P2: expired tokens treated as absent ─────────────────────────────────

  it("P2: safeReadSession rejeita sessão sem expires_at (legada) → session inicial null", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        global_user_id: "gu_old",
        email: "old@example.com",
        access_token: "tok_old",
        token_type: "Bearer",
        expires_in: 3600
        // expires_at ausente — sessão legada
      })
    );

    const { result } = renderHook(() =>
      useGlobalAuth({ apiBaseUrl: "http://localhost:3009", merchantId: "mrc_test" })
    );

    // Legacy session without expires_at must be treated as expired.
    expect(result.current.session).toBeNull();
  });

  it("P2: safeReadSession rejeita sessão com expires_at no passado → session inicial null", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        global_user_id: "gu_expired",
        email: "expired@example.com",
        access_token: "tok_expired",
        token_type: "Bearer",
        expires_in: 3600,
        expires_at: Date.now() - 1000 // expired 1 second ago
      })
    );

    const { result } = renderHook(() =>
      useGlobalAuth({ apiBaseUrl: "http://localhost:3009", merchantId: "mrc_test" })
    );

    expect(result.current.session).toBeNull();
  });

  it("P2: safeReadSession aceita sessão válida com expires_at no futuro", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        global_user_id: "gu_valid",
        email: "valid@example.com",
        access_token: "tok_valid",
        token_type: "Bearer",
        expires_in: 3600,
        expires_at: Date.now() + 3600 * 1000 // expires in 1 hour
      })
    );

    const { result } = renderHook(() =>
      useGlobalAuth({ apiBaseUrl: "http://localhost:3009", merchantId: "mrc_test" })
    );

    expect(result.current.session).not.toBeNull();
    expect(result.current.session?.email).toBe("valid@example.com");
  });

  it("P2: persist() carimba expires_at ao salvar sessão", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk(buildBuyerPayload()));

    const { result } = renderHook(() =>
      useGlobalAuth({ apiBaseUrl: "http://localhost:3009", merchantId: "mrc_test" })
    );

    const before = Date.now();
    await act(async () => {
      await result.current.verifyPhoneCode("11999999999", "123456");
    });
    const after = Date.now();

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    expect(stored.expires_at).toBeGreaterThan(before);
    expect(stored.expires_at).toBeLessThan(after + 3600 * 1000);
  });

  it("P2: loginFromCheckoutSession com token expirado → chama refreshBuyer", async () => {
    // Store an expired session
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        global_user_id: "gu_expired",
        email: "expired@example.com",
        access_token: "tok_expired",
        token_type: "Bearer",
        expires_in: 3600,
        expires_at: Date.now() - 1000
      })
    );

    // refreshBuyer endpoint
    fetchMock.mockResolvedValueOnce(jsonOk(buildBuyerPayload()));

    const { result } = renderHook(() =>
      useGlobalAuth({ apiBaseUrl: "http://localhost:3009", merchantId: "mrc_test" })
    );

    // Session is null due to expiry.
    expect(result.current.session).toBeNull();

    await act(async () => {
      await result.current.loginFromCheckoutSession("sess_123", "mrc_test");
    });

    // After refresh, session should be set.
    expect(result.current.session?.global_user_id).toBe("gu_123");
    // And the refresh endpoint was called.
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/buyer/login-from-session"),
      expect.any(Object)
    );
  });
});
