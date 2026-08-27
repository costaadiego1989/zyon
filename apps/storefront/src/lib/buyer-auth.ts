// Shared buyer-token helpers. A single source of truth for "is the buyer
// already authenticated?" so every checkout entry point behaves identically
// and a valid 7-day token skips the OTP gate entirely.

const TOKEN_KEY = "zyon_buyer_token";
const SESSION_KEY = "zyon_buyer_session";

export interface ValidBuyer {
  globalUserId: string;
  token: string;
  email?: string;
}

/**
 * Return the authenticated buyer if a non-expired token exists in localStorage,
 * otherwise null. Accepts both `sub` and `globalUserId` claim shapes. Removes an
 * expired/malformed token so the caller falls back to OTP cleanly.
 */
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
    // Expired — clear so the gate requires a fresh OTP.
    localStorage.removeItem(TOKEN_KEY);
    return null;
  } catch {
    // Malformed / non-JWT token — treat as unauthenticated.
    return null;
  }
}

export function clearBuyerSession(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(SESSION_KEY);
    // Also clear the BuyerHub's own session key so logout is global across
    // both the checkout gate and the hub panel.
    localStorage.removeItem("aacp_buyer_auth_session");
  } catch {}
}
