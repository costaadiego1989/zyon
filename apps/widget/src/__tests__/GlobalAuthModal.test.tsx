import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { GlobalAuthModal } from "../components/checkout/GlobalAuthModal.js";
import type { GlobalAuthController } from "../hooks/use-global-auth.js";
import type { AccountHubState } from "../hooks/use-account-hub.js";

function buildAuth(overrides: Partial<GlobalAuthController> = {}): GlobalAuthController {
  return {
    open: true,
    panel: "auth",
    mode: "login",
    email: "",
    password: "",
    merchantName: "",
    loading: false,
    error: null,
    status: null,
    session: null,
    openLogin: vi.fn(),
    openRegister: vi.fn(),
    openHub: vi.fn(),
    close: vi.fn(),
    setMode: vi.fn(),
    setEmail: vi.fn(),
    setPassword: vi.fn(),
    setMerchantName: vi.fn(),
    submit: vi.fn(),
    sendPhoneCode: vi.fn().mockResolvedValue(true),
    verifyPhoneCode: vi.fn().mockResolvedValue(true),
    logout: vi.fn(),
    ...overrides
  } as unknown as GlobalAuthController;
}

function buildHub(overrides: Partial<AccountHubState> = {}): AccountHubState {
  return {
    loading: false,
    error: null,
    section: "summary",
    data: { overview: null, merchant: null, merchantTheme: null, checkoutSettings: null, agentContext: null },
    setSection: vi.fn(),
    refresh: vi.fn(),
    ...overrides
  };
}

const BUYER_SESSION = {
  global_user_id: "guser_001",
  email: "buyer@test.com",
  access_token: "tok_test",
  token_type: "Bearer" as const,
  expires_in: 3600,
  provider: "phone" as const
};

const MERCHANT_SESSION = {
  merchant_id: "mrc_test",
  user_id: "usr_001",
  email: "merchant@test.com",
  access_token: "tok_merchant",
  token_type: "Bearer" as const,
  expires_in: 3600,
  merchant_name: "Loja Teste",
  provider: "password" as const
};

describe("GlobalAuthModal — auth panel (phone OTP)", () => {
  it("renders phone input when not closed", () => {
    const { container } = render(
      <GlobalAuthModal auth={buildAuth({ open: true })} hub={buildHub()} />
    );
    expect(container.querySelector('input[type="tel"]')).not.toBeNull();
  });

  it("renders nothing when open=false", () => {
    const { container } = render(
      <GlobalAuthModal auth={buildAuth({ open: false })} hub={buildHub()} />
    );
    expect(container.querySelector('input[type="tel"]')).toBeNull();
  });

  it("send-code button disabled when phone too short", () => {
    const { getByText } = render(
      <GlobalAuthModal auth={buildAuth({ open: true })} hub={buildHub()} />
    );
    const btn = getByText("Enviar codigo por SMS") as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it("send-code button enables after 10+ digit phone", async () => {
    const { container, getByText } = render(
      <GlobalAuthModal auth={buildAuth({ open: true })} hub={buildHub()} />
    );
    const input = container.querySelector('input[type="tel"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "(11) 99999-9999" } });
    await waitFor(() => {
      const btn = getByText("Enviar codigo por SMS") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  it("clicking send-code calls auth.sendPhoneCode", async () => {
    const sendPhoneCode = vi.fn().mockResolvedValue(true);
    const { container, getByText } = render(
      <GlobalAuthModal auth={buildAuth({ open: true, sendPhoneCode })} hub={buildHub()} />
    );
    const input = container.querySelector('input[type="tel"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "(11) 99999-9999" } });
    await waitFor(() => {
      const btn = getByText("Enviar codigo por SMS") as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(getByText("Enviar codigo por SMS"));
    await waitFor(() => {
      expect(sendPhoneCode).toHaveBeenCalledWith("11999999999");
    });
  });

  it("shows code input after sendPhoneCode succeeds", async () => {
    const sendPhoneCode = vi.fn().mockResolvedValue(true);
    const { container, getByText } = render(
      <GlobalAuthModal auth={buildAuth({ open: true, sendPhoneCode })} hub={buildHub()} />
    );
    const input = container.querySelector('input[type="tel"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: "(11) 99999-9999" } });
    fireEvent.click(getByText("Enviar codigo por SMS"));
    await waitFor(() => {
      expect(container.querySelector('input[placeholder="000000"]')).not.toBeNull();
    });
  });

  it("displays API error message when auth.error is set", () => {
    const { getByText } = render(
      <GlobalAuthModal
        auth={buildAuth({ open: true, error: "Código inválido." })}
        hub={buildHub()}
      />
    );
    expect(getByText("Código inválido.")).not.toBeNull();
  });

  it("close button calls auth.close", () => {
    const close = vi.fn();
    const { container } = render(
      <GlobalAuthModal auth={buildAuth({ open: true, close })} hub={buildHub()} />
    );
    const closeBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.querySelector("svg") && !b.textContent?.trim()
    );
    if (closeBtn) fireEvent.click(closeBtn);
    expect(close).toHaveBeenCalled();
  });
});

describe("GlobalAuthModal — hub panel", () => {
  it("renders hub panel with buyer email in header when panel=hub and session set", () => {
    const { container } = render(
      <GlobalAuthModal
        auth={buildAuth({ open: true, panel: "hub", session: BUYER_SESSION as any })}
        hub={buildHub()}
      />
    );
    expect(container.textContent).toContain("buyer@test.com");
    expect(container.querySelector(".zyon-hub-panel")).not.toBeNull();
  });

  it("renders hub panel with merchant email when merchant session", () => {
    const { container } = render(
      <GlobalAuthModal
        auth={buildAuth({ open: true, panel: "hub", session: MERCHANT_SESSION as any })}
        hub={buildHub()}
      />
    );
    expect(container.textContent).toContain("merchant@test.com");
  });

  it("shows hub loading state", () => {
    const { getByText } = render(
      <GlobalAuthModal
        auth={buildAuth({ open: true, panel: "hub", session: BUYER_SESSION as any })}
        hub={buildHub({ loading: true })}
      />
    );
    expect(getByText("Carregando...")).not.toBeNull();
  });

  it("shows hub error message when error present and not loading", () => {
    const { getByText } = render(
      <GlobalAuthModal
        auth={buildAuth({ open: true, panel: "hub", session: BUYER_SESSION as any })}
        hub={buildHub({ error: "Falha ao carregar o hub." })}
      />
    );
    expect(getByText("Falha ao carregar o hub.")).not.toBeNull();
  });

  it("logout button calls auth.logout", () => {
    const logout = vi.fn();
    const { getByText } = render(
      <GlobalAuthModal
        auth={buildAuth({ open: true, panel: "hub", session: BUYER_SESSION as any, logout })}
        hub={buildHub()}
      />
    );
    fireEvent.click(getByText("Sair da conta"));
    expect(logout).toHaveBeenCalledOnce();
  });

  it("does NOT render auth panel when panel=hub (no tel input)", () => {
    const { container } = render(
      <GlobalAuthModal
        auth={buildAuth({ open: true, panel: "hub", session: BUYER_SESSION as any })}
        hub={buildHub()}
      />
    );
    expect(container.querySelector('input[type="tel"]')).toBeNull();
  });
});
