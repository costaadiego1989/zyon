import { useEffect, useMemo, useState } from "react";
import { normalizeApiBase } from "../lib/embed-client.js";
import {
  authCredentialsSchema,
  authRegisterSchema,
  authResponseSchema,
  buyerAuthResponseSchema,
  globalAuthSessionSchema,
  type GlobalAuthSession
} from "../lib/widget-schemas.js";
import type { GlobalAuthMode } from "../lib/widget-types.js";

const AUTH_STORAGE_KEY = "aacp_global_auth_session";
const DEVICE_STORAGE_KEY = "aacp_global_device_id";

function safeReadSession(): GlobalAuthSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const result = globalAuthSessionSchema.safeParse(parsed);
    if (!result.success) return null;
    const s = result.data;
    // P2: treat tokens as absent when they are expired or have no expiry
    // timestamp (legacy sessions). This triggers proactive re-auth instead of
    // a guaranteed 401 on the next API call.
    if (!s.expires_at || Date.now() >= s.expires_at) return null;
    return s;
  } catch {
    return null;
  }
}

function parseBuyerAuthPayload(payload: unknown, merchantId?: string): GlobalAuthSession | null {
  const parsedBuyer = buyerAuthResponseSchema.safeParse(payload);
  if (parsedBuyer.success) {
    return {
      merchant_id: merchantId,
      global_user_id: parsedBuyer.data.globalUserId,
      email: parsedBuyer.data.email,
      access_token: parsedBuyer.data.accessToken,
      token_type: parsedBuyer.data.tokenType,
      expires_in: parsedBuyer.data.expiresIn,
      provider: "phone"
    };
  }

  if (!payload || typeof payload !== "object") return null;
  const snake = payload as {
    global_user_id?: string;
    globalUserId?: string;
    email?: string;
    access_token?: string;
    accessToken?: string;
    token_type?: "Bearer";
    tokenType?: "Bearer";
    expires_in?: number;
    expiresIn?: number;
  };

  const globalUserId = snake.global_user_id ?? snake.globalUserId;
  const accessToken = snake.access_token ?? snake.accessToken;
  const email = snake.email;
  if (!globalUserId || !accessToken || !email) return null;

  return {
    merchant_id: merchantId,
    global_user_id: globalUserId,
    email,
    access_token: accessToken,
    token_type: snake.token_type ?? snake.tokenType ?? "Bearer",
    expires_in: snake.expires_in ?? snake.expiresIn ?? 3600,
    provider: "phone"
  };
}

function stableDeviceId(): string {
  if (typeof window === "undefined") return "server-render";
  const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
  if (existing?.trim()) return existing;
  const next = crypto.randomUUID();
  window.localStorage.setItem(DEVICE_STORAGE_KEY, next);
  return next;
}

export interface GlobalAuthController {
  open: boolean;
  panel: "auth" | "hub";
  mode: GlobalAuthMode;
  email: string;
  password: string;
  merchantName: string;
  loading: boolean;
  error: string | null;
  status: string | null;
  session: GlobalAuthSession | null;
  openLogin: () => void;
  openRegister: () => void;
  openHub: () => void;
  close: () => void;
  setMode: (mode: GlobalAuthMode) => void;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setMerchantName: (value: string) => void;
  submit: () => Promise<void>;
  sendPhoneCode: (phone: string) => Promise<boolean>;
  verifyPhoneCode: (phone: string, code: string) => Promise<boolean>;
  loginFromCheckoutSession: (sessionId: string, merchantId: string) => Promise<boolean>;
  refreshBuyerFromCheckoutSession: (sessionId: string, merchantId: string) => Promise<boolean>;
  logout: () => void;
}

export function useGlobalAuth(options: {
  apiBaseUrl: string;
  merchantId?: string;
  defaultMerchantName?: string;
  defaultEmail?: string;
}): GlobalAuthController {
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<"auth" | "hub">("auth");
  const [mode, setMode] = useState<GlobalAuthMode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [merchantName, setMerchantName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [session, setSession] = useState<GlobalAuthSession | null>(() => safeReadSession());

  useEffect(() => {
    if (session) {
      setEmail(session.email);
      if (session.merchant_name) setMerchantName(session.merchant_name);
    }
  }, [session]);

  useEffect(() => {
    if (!email && options.defaultEmail) setEmail(options.defaultEmail);
  }, [email, options.defaultEmail]);

  useEffect(() => {
    if (!merchantName && options.defaultMerchantName) setMerchantName(options.defaultMerchantName);
  }, [merchantName, options.defaultMerchantName]);

  const apiOrigin = useMemo(() => normalizeApiBase(options.apiBaseUrl), [options.apiBaseUrl]);
  const deviceId = useMemo(() => stableDeviceId(), []);

  function persist(next: GlobalAuthSession): void {
    // P2: stamp an absolute expiry timestamp so safeReadSession can reject
    // stale tokens without a round-trip. 60-second buffer prevents edge-case
    // races where the token expires between persist and the first use.
    const expiresAt = Date.now() + (next.expires_in - 60) * 1000;
    const stamped: GlobalAuthSession = { ...next, expires_at: expiresAt };
    setSession(stamped);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(stamped));
    }
  }

  function openLogin(): void {
    setPanel("auth");
    setMode("login");
    setError(null);
    setStatus(null);
    setOpen(true);
  }

  function openRegister(): void {
    setPanel("auth");
    setMode("register");
    setError(null);
    setStatus(null);
    setOpen(true);
  }

  function openHub(): void {
    setPanel("hub");
    setError(null);
    setStatus(null);
    setOpen(true);
  }

  function close(): void {
    setOpen(false);
    setError(null);
  }

  function logout(): void {
    setSession(null);
    setPanel("auth");
    setStatus("Sessão global removida.");
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(AUTH_STORAGE_KEY);
    }
  }

  async function submit(): Promise<void> {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      if (mode === "login") {
        const parsed = authCredentialsSchema.safeParse({ email, password });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? "Dados inválidos para autenticação.");
          return;
        }

        const response = await fetch(`${apiOrigin}/auth/login`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-device-id": deviceId
          },
          credentials: "include",
          body: JSON.stringify({ email: parsed.data.email, password: parsed.data.password })
        });

        const payload = (await response.json()) as unknown;
        if (!response.ok) {
          const reason =
            typeof payload === "object" && payload != null && "message" in payload
              ? String((payload as { message?: unknown }).message ?? "Falha ao autenticar.")
              : "Falha ao autenticar.";
          setError(reason);
          return;
        }

        const parsedAuth = authResponseSchema.safeParse(payload);
        if (!parsedAuth.success) {
          setError("Resposta de autenticação inválida.");
          return;
        }

        persist({
          ...parsedAuth.data,
          merchant_name: session?.merchant_name,
          provider: "password"
        });
        setStatus("Login global realizado com sucesso.");
        setOpen(false);
        setPassword("");
        return;
      }

      const parsed = authRegisterSchema.safeParse({ email, password, merchantName });
      if (!parsed.success) {
        setError(parsed.error.issues[0]?.message ?? "Dados inválidos para autenticação.");
        return;
      }

      const response = await fetch(`${apiOrigin}/auth/register`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-device-id": deviceId
        },
        credentials: "include",
        body: JSON.stringify({
          merchant_name: parsed.data.merchantName,
          email: parsed.data.email,
          password: parsed.data.password
        })
      });

      const payload = (await response.json()) as unknown;
      if (!response.ok) {
        const reason =
          typeof payload === "object" && payload != null && "message" in payload
            ? String((payload as { message?: unknown }).message ?? "Falha ao autenticar.")
            : "Falha ao autenticar.";
        setError(reason);
        return;
      }

      const parsedAuth = authResponseSchema.safeParse(payload);
      if (!parsedAuth.success) {
        setError("Resposta de autenticação inválida.");
        return;
      }

      persist({
        ...parsedAuth.data,
        merchant_name: parsed.data.merchantName,
        provider: "password"
      });
      setStatus("Conta global criada com sucesso.");
      setOpen(false);
      setPassword("");
    } catch {
      // P2: network errors were previously swallowed by try/finally without a
      // catch, producing a silent failure. Surface them to the user.
      setError("Erro de rede ao autenticar.");
    } finally {
      setLoading(false);
    }
  }

  async function sendPhoneCode(phone: string): Promise<boolean> {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`${apiOrigin}/buyer/phone/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      if (!res.ok) {
        const payload = (await res.json()) as unknown;
        const reason =
          typeof payload === "object" && payload != null && "message" in payload
            ? String((payload as { message?: unknown }).message ?? "Falha ao enviar código.")
            : "Falha ao enviar código.";
        setError(reason);
        return false;
      }
      return true;
    } catch {
      setError("Erro de rede ao enviar código.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function verifyPhoneCode(phone: string, code: string): Promise<boolean> {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const res = await fetch(`${apiOrigin}/buyer/phone/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code }),
      });
      const payload = (await res.json()) as unknown;
      if (!res.ok) {
        const reason =
          typeof payload === "object" && payload != null && "message" in payload
            ? String((payload as { message?: unknown }).message ?? "Código inválido.")
            : "Código inválido.";
        setError(reason);
        return false;
      }
      // P1: pass the active merchantId so the persisted GlobalAuthSession carries
      // merchant_id. Without it the account hub never loads (it checks for merchant_id).
      const buyerSession = parseBuyerAuthPayload(payload, options.merchantId);
      if (buyerSession) {
        persist(buyerSession);
        setStatus("Login realizado com sucesso.");
        setOpen(false);
        return true;
      }
      setError("Resposta inválida do servidor.");
      return false;
    } catch {
      setError("Erro de rede ao verificar código.");
      return false;
    } finally {
      setLoading(false);
    }
  }

  async function refreshBuyerFromCheckoutSession(sessionId: string, merchantId: string): Promise<boolean> {
    try {
      const res = await fetch(`${apiOrigin}/buyer/login-from-session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session_id: sessionId, merchant_id: merchantId })
      });
      if (!res.ok) return false;
      const payload = (await res.json()) as unknown;
      const buyerSession = parseBuyerAuthPayload(payload, merchantId);
      if (!buyerSession) return false;
      persist({ ...buyerSession, provider: "password" });
      return true;
    } catch {
      return false;
    }
  }

  async function loginFromCheckoutSession(sessionId: string, merchantId: string): Promise<boolean> {
    // P2: treat expired tokens as absent to avoid guaranteed 401s on next hub call.
    const hasValidSession =
      Boolean(session?.global_user_id && session.access_token) &&
      (session?.expires_at ? Date.now() < session.expires_at : false);
    if (hasValidSession) return true;
    return refreshBuyerFromCheckoutSession(sessionId, merchantId);
  }

  return {
    open,
    panel,
    mode,
    email,
    password,
    merchantName,
    loading,
    error,
    status,
    session,
    openLogin,
    openRegister,
    openHub,
    close,
    setMode,
    setEmail,
    setPassword,
    setMerchantName,
    submit,
    sendPhoneCode,
    verifyPhoneCode,
    loginFromCheckoutSession,
    refreshBuyerFromCheckoutSession,
    logout
  };
}
