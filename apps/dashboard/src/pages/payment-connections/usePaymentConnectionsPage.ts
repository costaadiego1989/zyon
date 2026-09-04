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

export function usePaymentConnectionsPage(me: MerchantProfile | null) {
  const api = useApi();
  const [connections, setConnections] = useState<PaymentConnection[]>([]);
  const [operation, setOperation] = useState<Operation>("idle");
  const [alert, setAlert] = useState<{ message: string; kind: AlertKind } | null>(null);
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

  const [companyPrefill, setCompanyPrefill] = useState<Record<string, any> | null>(null);

  useEffect(() => {
    if (!me) {
      setConnections([]);
      return;
    }
    void load();
    void (async () => {
      try {
        const settings = await api.getStoreSettings();
        setCompanyPrefill((settings?.company as Record<string, any>) ?? null);
      } catch { setCompanyPrefill(null); }
    })();
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

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
    const [connRes, rulesRes] = await Promise.allSettled([
      api.getPaymentConnections(),
      api.getMerchantRules(),
    ]);

    if (connRes.status === "fulfilled") {
      setConnections(connRes.value);
    } else {
      console.error("[payment-connections] connections", connRes.reason);
      setAlert({ message: sanitizeError(connRes.reason), kind: "error" });
    }

    if (rulesRes.status === "fulfilled") {
      const cryptoRules = rulesRes.value.cryptoPayments;
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
    } else {
      console.error("[payment-connections] rules", rulesRes.reason);
    }

    setOperation("idle");
  }

  async function onboardStripe() {
    setOperation("connecting-stripe");
    setAlert(null);
    try {
      const { url } = await api.createStripeOnboardingLink({
        return_url: window.location.href,
        refresh_url: window.location.href,
      });
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

  async function createAsaasSubaccount(payload: Record<string, unknown>): Promise<boolean> {
    setOperation("connecting-asaas");
    setAlert(null);
    try {
      const created = await api.createAsaasSubaccount(payload);
      setConnections((prev) => {
        const idx = prev.findIndex((c) => c.provider === "asaas");
        return idx >= 0 ? prev.map((c, i) => (i === idx ? created : c)) : [created, ...prev];
      });
      showToast("success", "Subconta criada — complete o cadastro no Asaas para ativar.");
      setTimeout(() => { void openAsaasOnboarding(); }, 15500);
      return true;
    } catch (e) {
      console.error("[payment-connections]", e);
      setAlert({ message: sanitizeError(e), kind: "error" });
      return false;
    } finally {
      setOperation("idle");
    }
  }

  async function openAsaasOnboarding(): Promise<void> {
    setAlert(null);
    try {
      const { url } = await api.createAsaasOnboardingLink({ return_url: window.location.href });
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (e) {
      console.error("[payment-connections]", e);
      setAlert({ message: sanitizeError(e), kind: "error" });
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

  async function approveAsaasSandbox() {
    setOperation("syncing-asaas");
    setAlert(null);
    try {
      const updated = await api.approveAsaasSandbox();
      setConnections((prev) => {
        const idx = prev.findIndex((c) => c.id === updated.id);
        return idx >= 0 ? prev.map((c, i) => (i === idx ? updated : c)) : [updated, ...prev];
      });
      showToast("success", "Subconta aprovada (sandbox)");
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
      void load();
    }
  }

  return {
    connections,
    operation,
    alert,
    crypto,
    companyPrefill,
    setAlert,
    setCrypto,
    load,
    onboardStripe,
    syncStripe,
    createAsaasSubaccount,
    openAsaasOnboarding,
    syncAsaas,
    onboardMercadoPago,
    syncMercadoPago,
    saveCryptoWallet,
    disconnect,
    approveAsaasSandbox,
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
