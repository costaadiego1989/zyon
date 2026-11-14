import { useCallback, useState } from "react";
import { confirmStripePayment } from "@/api/payment";
import { reportError } from "@/lib/error-handler";
import type { PaymentViewModelInterface } from "./types";
import type { CheckoutSession } from "@/api/checkout-session";

interface PaymentContextInput {
  api: CheckoutSession;
  paymentIntentId: string;
  onSuccess: () => void;
}

export function usePaymentViewModel(input: PaymentContextInput): PaymentViewModelInterface {
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const confirmStripePaymentAction = useCallback(
    async (_paymentMethodId: string) => {
      setProcessing(true);
      setError(null);

      try {
        const res = await confirmStripePayment(input.api, {
          paymentIntentId: input.paymentIntentId,
        });

        if (res.ok) {
          setSuccess(true);
          input.onSuccess();
        } else {
          const err = new Error(`Stripe confirmation failed with status ${res.status}`);
          reportError(err, "PaymentVM.confirmStripe");
          setError("Pagamento processado mas confirmação falhou. Entre em contato.");
        }
      } catch (err) {
        reportError(err, "PaymentVM.confirmStripePayment");
        setError("Erro ao processar pagamento. Tente novamente.");
      } finally {
        setProcessing(false);
      }
    },
    [input.api, input.paymentIntentId, input.onSuccess]
  );

  const confirmPixPaymentAction = useCallback(
    async (_pixKey: string) => {
      setProcessing(true);
      setError(null);

      try {
        reportError(
          new Error("confirmPixPayment not yet implemented"),
          "PaymentVM.confirmPixPayment.stub"
        );
        setError("Pagamento via PIX não está disponível no momento.");
      } finally {
        setProcessing(false);
      }
    },
    []
  );

  const reset = useCallback(() => {
    setProcessing(false);
    setError(null);
    setSuccess(false);
  }, []);

  return {
    processing,
    error,
    success,
    confirmStripePayment: confirmStripePaymentAction,
    confirmPixPayment: confirmPixPaymentAction,
    reset,
  };
}
