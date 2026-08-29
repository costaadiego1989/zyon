import { getValidBuyer, type ValidBuyer } from "@/lib/buyer-auth";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

const API_ERROR_MESSAGES: Record<string, string> = {
  email_already_in_use: "Este e-mail já está em uso por outra conta.",
  email_already_registered: "Este e-mail já está cadastrado.",
  cpf_invalid: "CPF inválido. Verifique os dígitos.",
  buyer_account_not_found: "Conta não encontrada.",
};

export function friendlyApiError(raw: string): string {
  return API_ERROR_MESSAGES[raw] ?? raw;
}

export function getToken(): string | null {
  const buyer: ValidBuyer | null = getValidBuyer();
  return buyer?.token ?? null;
}

export async function apiCall<T>(
  path: string,
  init: RequestInit & { authRequired?: boolean } = {},
): Promise<T> {
  const headers = new Headers(init.headers ?? {});
  headers.set("Accept", "application/json");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const authRequired = init.authRequired !== false;
  if (authRequired) {
    const token = getToken();
    if (!token) throw new Error("Sessão expirada. Faça login novamente.");
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (!res.ok) {
    let msg = `Erro ${res.status}`;
    try {
      const j = await res.json();
      const raw = j?.message || j?.error || j?.detail || msg;
      msg = friendlyApiError(raw);
    } catch {}
    throw new Error(msg);
  }
  if (res.status === 204) return undefined as unknown as T;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}
