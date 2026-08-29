
const TOKEN_KEY = "zyon_buyer_token";
const SESSION_KEY = "zyon_buyer_session";

export interface ValidBuyer {
  globalUserId: string;
  token: string;
  email?: string;
}

export function getValidBuyer(): ValidBuyer | null {
  if (typeof window === "undefined") return null;
  let token: string | null;
  try {
    token = localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    const now = Math.floor(Date.now() / 1000);
    const globalUserId: string | undefined = payload.sub || payload.globalUserId;
    if (payload.exp && payload.exp > now && globalUserId) {
      let email: string | undefined;
      try {
        const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "{}");
        email = session.email;
      } catch {}
      return { globalUserId, token, email: email ?? payload.email };
    }
    localStorage.removeItem(TOKEN_KEY);
    return null;
  } catch {
    return null;
  }
}
export function clearBuyerSession(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem("aacp_buyer_auth_session");
  } catch {}
}
