import { useEffect, useMemo, useState } from "react";
import { normalizeApiBase } from "./embed-client.js";
import {
  authCredentialsSchema,
  authRegisterSchema,
  authResponseSchema,
  globalAuthSessionSchema,
  type GlobalAuthSession
} from "./widget-schemas.js";
import type { GlobalAuthMode } from "./widget-types.js";

const AUTH_STORAGE_KEY = "aacp_global_auth_session";
const DEVICE_STORAGE_KEY = "aacp_global_device_id";

function safeReadSession(): GlobalAuthSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(AUTH_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    const session = globalAuthSessionSchema.safeParse(parsed);
    return session.success ? session.data : null;
  } catch {
    return null;
  }
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
  close: () => void;
  setMode: (mode: GlobalAuthMode) => void;
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setMerchantName: (value: string) => void;
  submit: () => Promise<void>;
  logout: () => void;
}

export function useGlobalAuth(options: {
  apiBaseUrl: string;
  defaultMerchantName?: string;
  defaultEmail?: string;
}): GlobalAuthController {
  const [open, setOpen] = useState(false);
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
    setSession(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(next));
    }
  }

  function openLogin(): void {
    setMode("login");
    setError(null);
    setStatus(null);
    setOpen(true);
  }

  function openRegister(): void {
    setMode("register");
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
    } finally {
      setLoading(false);
    }
  }

  return {
    open,
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
    close,
    setMode,
    setEmail,
    setPassword,
    setMerchantName,
    submit,
    logout
  };
}
