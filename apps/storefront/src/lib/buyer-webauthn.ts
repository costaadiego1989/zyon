import { getValidBuyer } from "./buyer-auth";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";
export const supportsPasskeys = () => typeof window !== "undefined" && window.isSecureContext
  && typeof PublicKeyCredential !== "undefined" && !!navigator.credentials;

const decode = (value: string): ArrayBuffer => {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, c => c.charCodeAt(0)).buffer;
};
const encode = (value: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function post<T>(path: string, body: unknown, token?: string): Promise<T> {
  const response = await fetch(API_BASE + "/buyer/webauthn/" + path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error("Entre por e-mail novamente para ativar a biometria.");
    throw new Error("Não foi possível confirmar a biometria. Tente novamente ou entre por e-mail.");
  }
  return response.json() as Promise<T>;
}

export async function registerBuyerPasskey(): Promise<void> {
  const buyer = getValidBuyer();
  if (!buyer) throw new Error("Entre por e-mail antes de ativar a biometria.");
  if (!supportsPasskeys()) throw new Error("Este navegador não oferece biometria. Use o acesso por e-mail.");
  type Options = Omit<PublicKeyCredentialCreationOptions, "challenge" | "user"> & {
    challenge: string; user: { id: string; name: string; displayName: string };
  };
  const options = await post<Options>("register/options", {}, buyer.token);
  const credential = await navigator.credentials.create({ publicKey: {
    ...options, challenge: decode(options.challenge), user: { ...options.user, id: decode(options.user.id) },
  } }) as PublicKeyCredential | null;
  if (!credential) throw new DOMException("Cancelled", "NotAllowedError");
  const response = credential.response as AuthenticatorAttestationResponse;
  await post("register/verify", {
    challenge: options.challenge,
    credential: {
      id: credential.id, rawId: encode(credential.rawId), type: credential.type,
      response: { attestationObject: encode(response.attestationObject), clientDataJSON: encode(response.clientDataJSON) },
    },
  }, buyer.token);
}

export async function loginBuyerPasskey(): Promise<string> {
  if (!supportsPasskeys()) throw new Error("Este navegador não oferece biometria. Use o acesso por e-mail.");
  type Options = Omit<PublicKeyCredentialRequestOptions, "challenge" | "allowCredentials"> & {
    challenge: string; allowCredentials: { id: string; type: "public-key" }[];
  };
  const options = await post<Options>("login/options", {});
  const credential = await navigator.credentials.get({ publicKey: {
    ...options, challenge: decode(options.challenge),
    allowCredentials: options.allowCredentials.map(c => ({ ...c, id: decode(c.id) })),
  } }) as PublicKeyCredential | null;
  if (!credential) throw new DOMException("Cancelled", "NotAllowedError");
  const response = credential.response as AuthenticatorAssertionResponse;
  const session = await post<{ access_token: string; buyer_id: string; email: string }>("login/verify", {
    challenge: options.challenge,
    credential: {
      id: credential.id, rawId: encode(credential.rawId), type: credential.type,
      response: { authenticatorData: encode(response.authenticatorData), clientDataJSON: encode(response.clientDataJSON), signature: encode(response.signature) },
    },
  });
  if (!session.access_token || !session.buyer_id) throw new Error("Não foi possível iniciar a sessão. Entre por e-mail.");
  const payload = JSON.parse(new TextDecoder().decode(decode(session.access_token.split(".")[1])));
  localStorage.setItem("zyon_buyer_token", session.access_token);
  localStorage.setItem("zyon_buyer_session", JSON.stringify({ globalUserId: session.buyer_id, token: session.access_token, email: session.email }));
  localStorage.setItem("aacp_buyer_auth_session", JSON.stringify({
    global_user_id: session.buyer_id, access_token: session.access_token, email: session.email, expires_at: payload.exp * 1000,
  }));
  localStorage.removeItem("zyon_biometric_registered");
  window.dispatchEvent(new StorageEvent("storage", { key: "zyon_buyer_token", newValue: session.access_token }));
  return session.buyer_id;
}

export function biometricError(error: unknown): string {
  if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "AbortError")) {
    return "A biometria não foi concluída. Você pode tentar novamente ou entrar por e-mail.";
  }
  if (error instanceof DOMException && error.name === "SecurityError") {
    return "A biometria não está disponível neste endereço. Entre por e-mail.";
  }
  return error instanceof Error ? error.message : "Não foi possível usar a biometria. Entre por e-mail.";
}
