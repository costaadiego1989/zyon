import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import type { CheckoutAgentViewModel } from "../hooks/use-checkout-agent-view-model.js";
import type { StripeIntent } from "../hooks/use-checkout-payment.js";

// ── Stripe mocks (hoisted so they're available inside vi.mock factories) ──────
const { mockConfirmPayment, mockLoadStripe } = vi.hoisted(() => ({
  mockConfirmPayment: vi.fn(),
  mockLoadStripe: vi.fn()
}));

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PaymentElement: () => <div data-testid="stripe-payment-element" />,
  useStripe: () => ({ confirmPayment: mockConfirmPayment }),
  useElements: () => ({})
}));

vi.mock("@stripe/stripe-js", () => ({
  loadStripe: mockLoadStripe
}));
// ─────────────────────────────────────────────────────────────────────────────

// Import after mocks are declared
import { CreditCardForm, stripePromiseCache } from "../components/checkout/CreditCardForm.js";

const STRIPE_INTENT: StripeIntent = {
  intentId: "pi_test_1",
  clientSecret: "pi_test_secret_abc",
  publishableKey: "pk_test_xyz",
  amountCents: 30000,
  currency: "BRL"
};

function buildVm(overrides: Partial<CheckoutAgentViewModel> = {}): CheckoutAgentViewModel {
  return {
    stripeIntent: null,
    createPaymentIntent: vi.fn(),
    onStripePaymentConfirmed: vi.fn(),
    onStripePaymentError: vi.fn(),
    setShowCardForm: vi.fn(),
    busy: false,
    visibleTotals: { total: 300, currency: "BRL", subtotal: 300, shipping: 0, discount: 0 },
    colorMode: "dark",
    ...overrides
  } as unknown as CheckoutAgentViewModel;
}

describe("CreditCardForm", () => {
  beforeEach(() => {
    stripePromiseCache.clear();
    mockConfirmPayment.mockReset();
    mockLoadStripe.mockReset();
    mockLoadStripe.mockResolvedValue({ confirmPayment: mockConfirmPayment });
  });

  it("antes de init: renderiza botão 'Pagar com cartão', SEM inputs de cartão raw no DOM", () => {
    const vm = buildVm({ stripeIntent: null });
    const { container } = render(<CreditCardForm vm={vm} />);

    expect(container.textContent).toContain("Pagar com cartão");
    // Sem inputs raw de número de cartão, CVV, etc.
    expect(container.querySelector('input[type="text"]')).toBeNull();
    expect(container.querySelector('input[inputmode="numeric"]')).toBeNull();
    expect(container.querySelector('input[autocomplete="cc-number"]')).toBeNull();
    expect(container.querySelector('input[autocomplete="cc-csc"]')).toBeNull();
  });

  it("botão 'Pagar com cartão' chama createPaymentIntent('card') ao clicar", async () => {
    const createPaymentIntent = vi.fn().mockResolvedValue(undefined);
    const vm = buildVm({ stripeIntent: null, createPaymentIntent });

    const { getByText } = render(<CreditCardForm vm={vm} />);

    await act(async () => {
      fireEvent.click(getByText(/Pagar com cartão/i));
    });

    expect(createPaymentIntent).toHaveBeenCalledOnce();
    expect(createPaymentIntent).toHaveBeenCalledWith("card");
  });

  it("loading state durante init: botão desabilitado com spinner", async () => {
    let resolve!: () => void;
    const createPaymentIntent = vi.fn(
      () => new Promise<void>((r) => { resolve = r; })
    );
    const vm = buildVm({ stripeIntent: null, createPaymentIntent });

    const { container, getByText } = render(<CreditCardForm vm={vm} />);

    act(() => { fireEvent.click(getByText(/Pagar com cartão/i)); });

    await waitFor(() => {
      expect(container.textContent).toContain("Preparando pagamento");
    });

    const btn = container.querySelector("button:disabled");
    expect(btn).not.toBeNull();

    await act(async () => { resolve(); });
  });

  it("após init: stripeIntent definido → renderiza Stripe Elements (PaymentElement)", () => {
    const vm = buildVm({ stripeIntent: STRIPE_INTENT });
    const { getByTestId } = render(<CreditCardForm vm={vm} />);

    expect(getByTestId("stripe-payment-element")).not.toBeNull();
  });

  it("após init: loadStripe chamado com publishableKey correta", () => {
    const vm = buildVm({ stripeIntent: STRIPE_INTENT });
    render(<CreditCardForm vm={vm} />);

    expect(mockLoadStripe).toHaveBeenCalledWith("pk_test_xyz");
  });

  it("mesma publishableKey não chama loadStripe duas vezes (cache)", () => {
    render(<CreditCardForm vm={buildVm({ stripeIntent: STRIPE_INTENT })} />);
    render(<CreditCardForm vm={buildVm({ stripeIntent: STRIPE_INTENT })} />);

    expect(mockLoadStripe).toHaveBeenCalledTimes(1);
  });

  it("submit com sucesso → chama confirmPayment com redirect:if_required, chama onStripePaymentConfirmed", async () => {
    mockConfirmPayment.mockResolvedValueOnce({ error: undefined });

    const vm = buildVm({ stripeIntent: STRIPE_INTENT });
    const { container } = render(<CreditCardForm vm={vm} />);

    const form = container.querySelector("form");
    await act(async () => {
      fireEvent.submit(form!);
    });

    expect(mockConfirmPayment).toHaveBeenCalledOnce();
    expect(mockConfirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({ redirect: "if_required" })
    );
    expect(vm.onStripePaymentConfirmed).toHaveBeenCalledWith(30000, "BRL");
    expect(vm.setShowCardForm).toHaveBeenCalledWith(false);
  });

  it("submit com erro Stripe → exibe mensagem inline, chama onStripePaymentError", async () => {
    mockConfirmPayment.mockResolvedValueOnce({
      error: { message: "Your card was declined." }
    });

    const vm = buildVm({ stripeIntent: STRIPE_INTENT });
    const { container } = render(<CreditCardForm vm={vm} />);

    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Your card was declined.");
    });

    expect(vm.onStripePaymentError).toHaveBeenCalledWith("Your card was declined.");
    expect(vm.onStripePaymentConfirmed).not.toHaveBeenCalled();
    expect(vm.setShowCardForm).not.toHaveBeenCalled();
  });

  it("botão Cancelar chama setShowCardForm(false)", () => {
    const vm = buildVm({ stripeIntent: STRIPE_INTENT });
    const { getByText } = render(<CreditCardForm vm={vm} />);

    fireEvent.click(getByText("Cancelar"));

    expect(vm.setShowCardForm).toHaveBeenCalledWith(false);
  });

  it("texto de segurança menciona PCI DSS SAQ A", () => {
    const vm = buildVm({ stripeIntent: STRIPE_INTENT });
    const { container } = render(<CreditCardForm vm={vm} />);

    expect(container.textContent).toContain("PCI DSS SAQ A");
  });

  it("com stripeIntent: NUNCA existe input com número de cartão no DOM", () => {
    const vm = buildVm({ stripeIntent: STRIPE_INTENT });
    const { container } = render(<CreditCardForm vm={vm} />);

    // PaymentElement é mockado como <div> — nenhum input raw de cartão
    expect(container.querySelector('input[autocomplete="cc-number"]')).toBeNull();
    expect(container.querySelector('input[autocomplete="cc-csc"]')).toBeNull();
    expect(container.querySelector('input[name="cardNumber"]')).toBeNull();
    expect(container.querySelector('input[name="cvv"]')).toBeNull();
  });
});
