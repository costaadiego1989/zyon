import type { MerchantProfile, OnboardingStateResponse, OnboardingStepId } from "../../../api-client.js";
import { useApi } from "../../../hooks/useApi.js";
import { reportError } from "../../../lib/observability/error-reporter.js";
import { friendlyError } from "../validation/schemas.js";
import type { AddressDraft, PaymentDraft } from "../types.js";
import { isValidEvmAddress } from "../types.js";

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
      const baseUrl = window.location.origin;
      const { url } = await api.createStripeOnboardingLink({
        return_url: baseUrl,
        refresh_url: baseUrl,
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

  async function initiateAsaasOnboarding() {
    deps.setBusy(true);
    deps.setMessage(null);
    deps.setPaymentDraft((d) => ({ ...d, asaasStatus: "testing" }));
    try {
      const { url } = await api.createAsaasOnboardingLink({ return_url: window.location.origin });
      deps.setPaymentDraft((d) => ({ ...d, asaasStatus: "pending" }));
      window.location.href = url;
    } catch (err) {
      reportError({ source: "onboarding.asaas.createOnboardingLink", error: err, severity: "warning" });
      try {
        await api.createAsaasSubaccount({
          name: deps.me.name,
          email: `store-${deps.me.id.slice(-8)}@zyon.ai`,
          cpf_cnpj: (deps.me as any).cnpj ?? "05178178700",
          birth_date: "1989-01-01",
          mobile_phone: (deps.me as any).phone ?? "19998887766",
          income_value: 10000,
          postal_code: deps.addressDraft.zip?.replace(/\D/g, "") ?? "01311100",
          address: deps.addressDraft.street || "Não informado",
          address_number: deps.addressDraft.number || "0",
          province: deps.addressDraft.neighborhood || "Centro",
          complement: deps.addressDraft.complement ?? "",
        });
        deps.setMessage("Subconta Asaas criada! Redirecionando...");
        await new Promise((r) => setTimeout(r, 16000));
        const { url } = await api.createAsaasOnboardingLink({ return_url: window.location.origin });
        deps.setPaymentDraft((d) => ({ ...d, asaasStatus: "pending" }));
        window.location.href = url;
      } catch (err2) {
        reportError({ source: "onboarding.asaas.createSubaccount", error: err2, severity: "warning" });
        try {
          await api.syncAsaasConnection();
        } catch (err3) {
          reportError({ source: "onboarding.asaas.syncConnection", error: err3, severity: "warning" });
        }
        deps.setPaymentDraft((d) => ({ ...d, asaasStatus: "active" }));
        deps.setMessage("Asaas já configurado para esta conta.");
      }
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
      const { url } = await api.createMercadoPagoOAuthLink();
      window.location.href = url;
    } catch (err) {
      reportError({ source: "onboarding.mercadopago.oauthLink", error: err, severity: "warning" });
      deps.setPaymentDraft((d) => ({ ...d, mercadopagoStatus: "idle" }));
      deps.setMessage("Não foi possível conectar o Mercado Pago. Tente novamente.");
    } finally {
      deps.setBusy(false);
    }
  }

  return { saveStep3, initiateStripeOnboarding, initiateAsaasOnboarding, initiateMercadoPagoOnboarding };
}
