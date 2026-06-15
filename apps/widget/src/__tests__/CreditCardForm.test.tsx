import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import type { StripeIntent } from "../hooks/use-checkout-payment.js";
import type { CreditCardFormModel } from "../presentation/models/credit-card-form.model.js";

const { mockConfirmPayment, mockLoadStripe } = vi.hoisted(() => ({
  mockConfirmPayment: vi.fn(),
  mockLoadStripe: vi.fn(),
}));

vi.mock("@stripe/react-stripe-js", () => ({
  Elements: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  PaymentElement: () => <div data-testid="stripe-payment-element" />,
  useStripe: () => ({ confirmPayment: mockConfirmPayment }),
  useElements: () => ({}),
}));

vi.mock("@stripe/stripe-js", () => ({
  loadStripe: mockLoadStripe,
}));

import { CreditCardForm, stripePromiseCache } from "../components/checkout/CreditCardForm.js";

const STRIPE_INTENT: StripeIntent = {
  intentId: "pi_test_1",
  clientSecret: "pi_test_secret_abc",
  publishableKey: "pk_test_xyz",
  amountCents: 30000,
  currency: "BRL",
};

function buildModel(overrides: Partial<CreditCardFormModel> = {}): CreditCardFormModel {
  return {
    busy: false,
    colorMode: "dark",
    totalLabel: "R$ 300,00",
    stripeIntent: null,
    onInitiate: vi.fn(),
    onStripePaymentConfirmed: vi.fn(),
    onStripePaymentError: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
}

describe("CreditCardForm", () => {
  beforeEach(() => {
    stripePromiseCache.clear();
    mockConfirmPayment.mockReset();
    mockLoadStripe.mockReset();
    mockLoadStripe.mockResolvedValue({ confirmPayment: mockConfirmPayment });
  });

  it("antes de init: renderiza botão 'Pagar com cartão', SEM inputs de cartão raw no DOM", () => {
    const { container } = render(<CreditCardForm model={buildModel()} />);

    expect(container.textContent).toContain("Pagar com cartão");
    expect(container.querySelector('input[type="text"]')).toBeNull();
    expect(container.querySelector('input[inputmode="numeric"]')).toBeNull();
    expect(container.querySelector('input[autocomplete="cc-number"]')).toBeNull();
    expect(container.querySelector('input[autocomplete="cc-csc"]')).toBeNull();
  });

  it("botão 'Pagar com cartão' chama onInitiate ao clicar", async () => {
    const onInitiate = vi.fn().mockResolvedValue(undefined);
    const { getByText } = render(<CreditCardForm model={buildModel({ onInitiate })} />);

    await act(async () => {
      fireEvent.click(getByText(/Pagar com cartão/i));
    });

    expect(onInitiate).toHaveBeenCalledOnce();
  });

  it("loading state durante init: botão desabilitado com spinner", async () => {
    let resolve!: () => void;
    const onInitiate = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    const { container, getByText } = render(<CreditCardForm model={buildModel({ onInitiate })} />);

    act(() => { fireEvent.click(getByText(/Pagar com cartão/i)); });

    await waitFor(() => {
      expect(container.textContent).toContain("Preparando pagamento");
    });

    const btn = container.querySelector("button:disabled");
    expect(btn).not.toBeNull();

    await act(async () => { resolve(); });
  });

  it("após init: stripeIntent definido → renderiza Stripe Elements (PaymentElement)", () => {
    const { getByTestId } = render(
      <CreditCardForm model={buildModel({ stripeIntent: STRIPE_INTENT })} />,
    );

    expect(getByTestId("stripe-payment-element")).not.toBeNull();
  });

  it("após init: loadStripe chamado com publishableKey correta", () => {
    render(<CreditCardForm model={buildModel({ stripeIntent: STRIPE_INTENT })} />);

    expect(mockLoadStripe).toHaveBeenCalledWith("pk_test_xyz");
  });

  it("mesma publishableKey não chama loadStripe duas vezes (cache)", () => {
    render(<CreditCardForm model={buildModel({ stripeIntent: STRIPE_INTENT })} />);
    render(<CreditCardForm model={buildModel({ stripeIntent: STRIPE_INTENT })} />);

    expect(mockLoadStripe).toHaveBeenCalledTimes(1);
  });

  it("submit com sucesso → chama confirmPayment com redirect:if_required, chama onStripePaymentConfirmed", async () => {
    mockConfirmPayment.mockResolvedValueOnce({ error: undefined });

    const model = buildModel({ stripeIntent: STRIPE_INTENT });
    const { container } = render(<CreditCardForm model={model} />);

    const form = container.querySelector("form");
    await act(async () => {
      fireEvent.submit(form!);
    });

    expect(mockConfirmPayment).toHaveBeenCalledOnce();
    expect(mockConfirmPayment).toHaveBeenCalledWith(
      expect.objectContaining({ redirect: "if_required" }),
    );
    expect(model.onStripePaymentConfirmed).toHaveBeenCalledWith(30000, "BRL");
    expect(model.onClose).toHaveBeenCalledWith();
  });

  it("submit com erro Stripe → exibe mensagem inline, chama onStripePaymentError", async () => {
    mockConfirmPayment.mockResolvedValueOnce({
      error: { message: "Your card was declined." },
    });

    const model = buildModel({ stripeIntent: STRIPE_INTENT });
    const { container } = render(<CreditCardForm model={model} />);

    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });

    await waitFor(() => {
      expect(container.textContent).toContain("Your card was declined.");
    });

    expect(model.onStripePaymentError).toHaveBeenCalledWith("Your card was declined.");
    expect(model.onStripePaymentConfirmed).not.toHaveBeenCalled();
    expect(model.onClose).not.toHaveBeenCalled();
  });

  it("botão Cancelar chama onClose", () => {
    const model = buildModel({ stripeIntent: STRIPE_INTENT });
    const { getByText } = render(<CreditCardForm model={model} />);

    fireEvent.click(getByText("Cancelar"));

    expect(model.onClose).toHaveBeenCalledWith();
  });

  it("texto de segurança menciona PCI DSS SAQ A", () => {
    const { container } = render(
      <CreditCardForm model={buildModel({ stripeIntent: STRIPE_INTENT })} />,
    );

    expect(container.textContent).toContain("PCI DSS SAQ A");
  });

  it("com stripeIntent: NUNCA existe input com número de cartão no DOM", () => {
    const { container } = render(
      <CreditCardForm model={buildModel({ stripeIntent: STRIPE_INTENT })} />,
    );

    expect(container.querySelector('input[autocomplete="cc-number"]')).toBeNull();
    expect(container.querySelector('input[autocomplete="cc-csc"]')).toBeNull();
    expect(container.querySelector('input[name="cardNumber"]')).toBeNull();
    expect(container.querySelector('input[name="cvv"]')).toBeNull();
  });
});
