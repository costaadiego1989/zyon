import type { MerchantProfile, OnboardingStateResponse, OnboardingStepId } from "../../../api-client.js";
import { useApi } from "../../../hooks/useApi.js";
import { reportError } from "../../../lib/observability/error-reporter.js";
import { friendlyError } from "../validation/schemas.js";
import type { AddressDraft, PaymentDraft } from "../types.js";
import { isValidEvmAddress } from "../types.js";
import type { AsaasConnectionPayload } from "../../payment-connections/components/AsaasConnectionForm.js";

export interface UseStepPaymentDeps {
  paymentDraft: PaymentDraft;
  setPaymentDraft: React.Dispatch<React.SetStateAction<PaymentDraft>>;
  addressDraft: AddressDraft;
  setFieldErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  setMessage: (msg: string | null) => void;
  setBusy: (b: boolean) => void;
  markOnboardingStep: (step: OnboardingStepId) => Promise<void>;
  setCurrentStep: React.Dispatch<React.SetStateAction<number>>;
  setOnboardingState: React.Dispatch<React.SetStateAction<OnboardingStateResponse | null>>;
  me: MerchantProfile;
  storageKey: string;
}

export function useStepPayment(deps: UseStepPaymentDeps) {
  const api = useApi();

  async function saveStep3() {
    const trimmedWallet = deps.paymentDraft.walletAddress.trim();
    if (trimmedWallet !== deps.paymentDraft.walletAddress) {
      deps.setPaymentDraft((d) => ({ ...d, walletAddress: trimmedWallet }));
    }

    if (deps.paymentDraft.cryptoEnabled && !isValidEvmAddress(trimmedWallet)) {
      deps.setFieldErrors({ walletAddress: "Endereço EVM inválido (0x + 40 caracteres hex)" });
      return;
    }
    deps.setFieldErrors({});
    deps.setBusy(true);
    deps.setMessage(null);
    try {
      const hasCrypto = deps.paymentDraft.cryptoEnabled && isValidEvmAddress(trimmedWallet);
      if (hasCrypto) {
        await api.putMerchantRules({
          cryptoPayments: {
            enabled: true,
            chain: "polygon",
            network: "mainnet",
            treasuryAddress: trimmedWallet,
            token: "USDC",
            quoteTtlSeconds: 300,
          },
        });
      }
      await deps.markOnboardingStep("checkout_config");
      // Continue to the WhatsApp step (5); Motor de IA follows as step 6.
      deps.setCurrentStep(5);
    } catch (e) {
      deps.setMessage(friendlyError(e));
    } finally {
      deps.setBusy(false);
    }
  }

  async function initiateStripeOnboarding() {
    deps.setBusy(true);
    deps.setMessage(null);
    try {
      const { url } = await api.createStripeOnboardingLink({
        return_to: "onboarding",
      });
      deps.setPaymentDraft((d) => ({ ...d, stripeStatus: "pending" }));
      window.location.href = url;
    } catch (e) {
      deps.setPaymentDraft((d) => ({ ...d, stripeStatus: "idle" }));
      deps.setMessage(friendlyError(e));
    } finally {
      deps.setBusy(false);
    }
  }

  async function initiateAsaasOnboarding(payload?: AsaasConnectionPayload): Promise<boolean> {
    deps.setBusy(true);
    deps.setMessage(null);
    deps.setPaymentDraft((d) => ({ ...d, asaasStatus: "testing" }));
    let connectionSaved = deps.paymentDraft.asaasStatus === "pending";
    try {
      if (payload) {
        const created = "api_key" in payload ? await api.connectAsaas(payload) : await api.createAsaasSubaccount({ ...payload });
        connectionSaved = true;
        deps.setPaymentDraft((d) => ({ ...d, asaasStatus: created.status === "active" ? "active" : "pending" }));
        deps.setMessage(created.status === "active" ? "Asaas conectado com sucesso." : "Conta Asaas vinculada. Conclua as pendências no Asaas e aguarde a aprovação para ativar os pagamentos.");
        return true;
      }
      const connection = await api.syncAsaasConnection();
      connectionSaved = true;
      if (connection.status === "active") {
        deps.setPaymentDraft((d) => ({ ...d, asaasStatus: "active" }));
        deps.setMessage("Asaas conectado com sucesso.");
        return true;
      }
      deps.setPaymentDraft((d) => ({ ...d, asaasStatus: "pending" }));
      const { url } = await api.createAsaasOnboardingLink({ return_url: window.location.origin });
      window.location.href = url;
      return true;
    } catch (err) {
      reportError({ source: "onboarding.asaas.connect", error: err, severity: "warning" });
      deps.setPaymentDraft((d) => ({ ...d, asaasStatus: connectionSaved ? "pending" : "error" }));
      deps.setMessage(friendlyError(err));
      return false;
    } finally {
      deps.setBusy(false);
    }
  }

  // Mercado Pago: OAuth link → redirect to Mercado Pago; on return the
  // ?mercadopago_connected=1 param is picked up by the wizard hook.
  async function initiateMercadoPagoOnboarding() {
    deps.setBusy(true);
    deps.setMessage(null);
    deps.setPaymentDraft((d) => ({ ...d, mercadopagoStatus: "connecting" }));
    try {
      const { url } = await api.createMercadoPagoOAuthLink({ return_to: "onboarding" });
      window.location.href = url;
    } catch (err) {
      reportError({ source: "onboarding.mercadopago.oauthLink", error: err, severity: "warning" });
      deps.setPaymentDraft((d) => ({ ...d, mercadopagoStatus: "idle" }));
      deps.setMessage(friendlyError(err));
    } finally {
      deps.setBusy(false);
    }
  }

  return { saveStep3, initiateStripeOnboarding, initiateAsaasOnboarding, initiateMercadoPagoOnboarding };
}
