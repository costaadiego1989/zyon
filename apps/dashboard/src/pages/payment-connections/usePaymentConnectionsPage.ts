import { useEffect, useState } from "react";
import { showToast } from "../../components/Toast.js";
import {
  DashboardHttpError,
  type PaymentConnection,
  type MerchantProfile,
} from "../../api-client.js";
import { useApi } from "../../hooks/useApi.js";

export type Operation =
  | "idle"
  | "loading"
  | "connecting-stripe"
  | "connecting-asaas"
  | "connecting-mercadopago"
  | "syncing-stripe"
  | "syncing-asaas"
  | "syncing-mercadopago";

export type AlertKind = "success" | "error" | "info";

export interface CryptoConfig {
  enabled: boolean;
  chain: "polygon" | "base";
  network: "mainnet" | "testnet";
  treasuryAddress: string;
}

export interface CryptoWalletState {
  config: CryptoConfig;
  saving: boolean;
  saved: boolean;
}

export interface AsaasState {
  apiKey: string;
  webhookToken: string;
  sandbox: boolean;
  saving: boolean;
}

export function usePaymentConnectionsPage(me: MerchantProfile | null) {
  const api = useApi();

  // Connections
  const [connections, setConnections] = useState<PaymentConnection[]>([]);

  // UI state
  const [operation, setOperation] = useState<Operation>("idle");
  const [alert, setAlert] = useState<{ message: string; kind: AlertKind } | null>(null);

  // Asaas modal state
  const [asaas, setAsaas] = useState<AsaasState>({
    apiKey: "",
    webhookToken: "",
    sandbox: true,
    saving: false,
  });

  // Crypto wallet state
  const [crypto, setCrypto] = useState<CryptoWalletState>({
    config: {
      enabled: false,
      chain: "polygon",
      network: "testnet",
      treasuryAddress: "",
    },
    saving: false,
    saved: false,
  });

  useEffect(() => {
    if (!me) {
      setConnections([]);
      return;
    }
    void load();
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  // Post-OAuth return: Mercado Pago's callback redirects back with a flag.
  // Toast the outcome and clear the query param so a refresh doesn't re-toast.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("mercadopago_connected");
    const errored = params.get("mercadopago_error");
    const stripeConnected = params.get("stripe_connected");
    const stripeRefresh = params.get("stripe_refresh");
    if (!connected && !errored && !stripeConnected && !stripeRefresh) return;
    if (connected) showToast("success", "Mercado Pago conectado");
    if (errored) showToast("error", "Falha ao conectar o Mercado Pago");
    // Stripe onboarding finished — sync the account so status leaves "pending".
    if (stripeConnected) {
      showToast("success", "Stripe conectado — sincronizando status...");
      void syncStripe();
    }
    if (stripeRefresh) showToast("error", "Link do Stripe expirou. Tente conectar novamente.");
    params.delete("mercadopago_connected");
    params.delete("mercadopago_error");
    params.delete("stripe_connected");
    params.delete("stripe_refresh");
    const qs = params.toString();
    const url = window.location.pathname + (qs ? `?${qs}` : "") + window.location.hash;
    window.history.replaceState({}, "", url);
  }, []);

  async function load() {
    setOperation("loading");
    setAlert(null);
    try {
      const [paymentConnections, rules] = await Promise.all([
        api.getPaymentConnections(),
        api.getMerchantRules(),
      ]);
      setConnections(paymentConnections);

      const cryptoRules = rules.cryptoPayments;
      if (cryptoRules) {
        setCrypto((prev) => ({
          ...prev,
          config: {
            enabled: cryptoRules.enabled === true,
            chain: cryptoRules.chain === "base" ? "base" : "polygon",
            network: cryptoRules.network === "mainnet" ? "mainnet" : "testnet",
            treasuryAddress: cryptoRules.treasuryAddress ?? "",
          },
        }));
      }
    } catch (e) {
      console.error("[payment-connections]", e);
      setAlert({ message: sanitizeError(e), kind: "error" });
    } finally {
      setOperation("idle");
    }
  }

  async function onboardStripe() {
    setOperation("connecting-stripe");
    setAlert(null);
    try {
      const { url } = await api.createStripeOnboardingLink({
        return_url: window.location.href,
        refresh_url: window.location.href,
      });
      // Same-tab so Stripe's return_url lands back on this page with the flag.
      window.location.href = url;
    } catch (e) {
      console.error("[payment-connections]", e);
      setAlert({ message: sanitizeError(e), kind: "error" });
    } finally {
      setOperation("idle");
    }
  }

  async function syncStripe() {
    setOperation("syncing-stripe");
    setAlert(null);
    try {
      const updated = await api.syncStripeConnection();
      setConnections((prev) => {
        const idx = prev.findIndex((c) => c.id === updated.id);
        return idx >= 0 ? prev.map((c, i) => (i === idx ? updated : c)) : [updated, ...prev];
      });
      showToast("success", "Provedor conectado com sucesso");
    } catch (e) {
      console.error("[payment-connections]", e);
      setAlert({ message: sanitizeError(e), kind: "error" });
    } finally {
      setOperation("idle");
    }
  }

  async function onboardAsaas() {
    setOperation("connecting-asaas");
    setAlert(null);
    try {
      const { url } = await api.createAsaasOnboardingLink({ return_url: window.location.href });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error("[payment-connections]", e);
      setAlert({ message: sanitizeError(e), kind: "error" });
    } finally {
      setOperation("idle");
    }
  }

  async function saveAsaasConfig() {
    setAsaas((prev) => ({ ...prev, saving: true }));
    setAlert(null);
    try {
      const updated = await api.connectAsaas({
        api_key: asaas.apiKey.trim(),
        webhook_token: asaas.webhookToken.trim(),
        sandbox: asaas.sandbox,
      });
      setConnections((prev) => {
        const idx = prev.findIndex((c) => c.provider === "asaas");
        return idx >= 0 ? prev.map((c, i) => (i === idx ? updated : c)) : [updated, ...prev];
      });
      showToast("success", "Asaas configurado com sucesso");
    } catch (e) {
      console.error("[payment-connections]", e);
      setAlert({ message: sanitizeError(e), kind: "error" });
    } finally {
      setAsaas((prev) => ({ ...prev, saving: false }));
    }
  }

  async function syncAsaas() {
    setOperation("syncing-asaas");
    setAlert(null);
    try {
      const updated = await api.syncAsaasConnection();
      setConnections((prev) => {
        const idx = prev.findIndex((c) => c.id === updated.id);
        return idx >= 0 ? prev.map((c, i) => (i === idx ? updated : c)) : [updated, ...prev];
      });
      showToast("success", "Conexão verificada");
    } catch (e) {
      console.error("[payment-connections]", e);
      setAlert({ message: sanitizeError(e), kind: "error" });
    } finally {
      setOperation("idle");
    }
  }

  async function onboardMercadoPago() {
    setOperation("connecting-mercadopago");
    setAlert(null);
    try {
      const { url } = await api.createMercadoPagoOAuthLink();
      // Same-tab redirect so MP's callback returns to this page with the
      // ?mercadopago_connected flag (a new tab would leave this one stale).
      window.location.href = url;
    } catch (e) {
      console.error("[payment-connections]", e);
      setAlert({ message: sanitizeError(e), kind: "error" });
    } finally {
      setOperation("idle");
    }
  }

  async function syncMercadoPago() {
    setOperation("syncing-mercadopago");
    setAlert(null);
    try {
      const updated = await api.syncMercadoPagoConnection();
      setConnections((prev) => {
        const idx = prev.findIndex((c) => c.id === updated.id);
        return idx >= 0 ? prev.map((c, i) => (i === idx ? updated : c)) : [updated, ...prev];
      });
      showToast("success", "Conexão verificada");
    } catch (e) {
      console.error("[payment-connections]", e);
      setAlert({ message: sanitizeError(e), kind: "error" });
    } finally {
      setOperation("idle");
    }
  }

  async function saveCryptoWallet() {
    setCrypto((prev) => ({ ...prev, saving: true, saved: false }));
    try {
      await api.putMerchantRules({
        cryptoPayments: {
          enabled: crypto.config.enabled,
          chain: crypto.config.chain,
          network: crypto.config.network,
          treasuryAddress: crypto.config.treasuryAddress.trim(),
          token: "USDC",
          quoteTtlSeconds: 900,
          brlPerUsdc: 5.5,
        },
      });
      setCrypto((prev) => ({ ...prev, saved: true }));
      showToast("success", "Wallet salva com sucesso");
      setTimeout(() => {
        setCrypto((prev) => ({ ...prev, saved: false }));
      }, 4000);
    } catch (e) {
      setAlert({ message: sanitizeError(e), kind: "error" });
    } finally {
      setCrypto((prev) => ({ ...prev, saving: false }));
    }
  }

  async function disconnect(provider: "stripe" | "asaas" | "mercadopago") {
    setOperation("loading");
    setAlert(null);
    try {
      await api.disconnectPaymentConnection(provider);
      setConnections((prev) => prev.filter((c) => c.provider !== provider));
      showToast("success", "Provedor desconectado");
    } catch (e) {
      console.error("[payment-connections]", e);
      setAlert({ message: sanitizeError(e), kind: "error" });
    } finally {
      setOperation("idle");
      // Re-sync from server so status reflects reality.
      void load();
    }
  }

  return {
    // State
    connections,
    operation,
    alert,
    asaas,
    crypto,

    // Setters
    setAlert,
    setAsaas,
    setCrypto,

    // Actions
    load,
    onboardStripe,
    syncStripe,
    onboardAsaas,
    saveAsaasConfig,
    syncAsaas,
    onboardMercadoPago,
    syncMercadoPago,
    saveCryptoWallet,
    disconnect,
  };
}

export function sanitizeError(e: unknown): string {
  if (e instanceof DashboardHttpError) {
    const { status } = e;
    if (status === 401) return "Sessão expirada. Faça login novamente.";
    if (status === 403) return "Sem permissão para esta ação.";
    if (status === 409) return "Já existe uma conexão ativa. Remova a atual primeiro.";
    if (status === 422) return "Não foi possível conectar. Verifique suas credenciais.";
    if (status >= 500) return "Erro interno. Tente novamente em alguns minutos.";
    return "Ocorreu um erro inesperado. Tente novamente.";
  }
  if (e instanceof TypeError) return "Sem conexão com o servidor.";
  return "Ocorreu um erro inesperado. Tente novamente.";
}

export function formatDate(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(iso));
}
