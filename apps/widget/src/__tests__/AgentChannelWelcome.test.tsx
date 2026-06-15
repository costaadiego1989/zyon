import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AgentChannelWelcome } from "../features/onboarding/AgentChannelWelcome.js";
import type { CheckoutAgentViewModel } from "../hooks/use-checkout-agent-view-model.js";

function buildVm(overrides: Partial<CheckoutAgentViewModel> = {}): CheckoutAgentViewModel {
  return {
    theme: { agentName: "Zion", agentAvatarUrl: undefined },
    activeExperience: {
      agent: { name: "Zion", greeting: "Olá" },
      brand: { name: "Northstar Atelier" },
    },
    session: { session_id: "chk_1" },
    networkError: null,
    busy: false,
    showChannelWelcome: true,
    selectPurchaseChannel: vi.fn(),
    retryStartCheckout: vi.fn(),
    colorMode: "light",
    ...overrides,
  } as unknown as CheckoutAgentViewModel;
}

describe("AgentChannelWelcome", () => {
  it("não renderiza quando o modal está fechado", () => {
    const { container } = render(<AgentChannelWelcome vm={buildVm({ showChannelWelcome: false })} />);
    expect(container.firstChild).toBeNull();
  });

  it("abre modal e dispara escolha de canal", () => {
    const selectPurchaseChannel = vi.fn();
    render(<AgentChannelWelcome vm={buildVm({ selectPurchaseChannel })} />);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Sou Zion/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Comprar por chat/i }));
    expect(selectPurchaseChannel).toHaveBeenCalledWith("chat");

    fireEvent.click(screen.getByRole("button", { name: /Comprar por voz/i }));
    expect(selectPurchaseChannel).toHaveBeenCalledWith("voice");
  });
});
