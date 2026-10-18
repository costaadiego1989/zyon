import type { PlatformAuthResponse, PlatformOperator } from "./api.js";

const SESSION_KEY = "zyon.platform-control.session.v1";

type StoredSession = {
  token: string;
  operator: PlatformOperator;
};

export function readPlatformSession(): StoredSession | null {
  try {
    const raw = window.sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed.token || !parsed.operator?.operator_id || !parsed.operator.email || !parsed.operator.role) return null;
    return parsed as StoredSession;
  } catch {
    return null;
  }
}

export function writePlatformSession(response: PlatformAuthResponse | StoredSession): void {
  const session: StoredSession = "access_token" in response
    ? {
      token: response.access_token,
      operator: {
        operator_id: response.operator_id,
        email: response.email,
        role: response.role,
      },
    }
    : response;
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearPlatformSession(): void {
  window.sessionStorage.removeItem(SESSION_KEY);
}
