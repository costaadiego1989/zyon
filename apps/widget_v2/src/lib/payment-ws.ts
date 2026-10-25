/**
 * Payment WebSocket client with graceful fallback.
 * Connects to /ws gateway to receive real-time payment status updates.
 * Returns cleanup function for caller to manage lifecycle.
 */

export interface PaymentWsOptions {
  apiBaseUrl: string;
  token: string;
  intentId: string;
  onApproved: () => void;
  onFailed: () => void;
  onError: () => void;
}

export interface PaymentStatusMessage {
  event: "payment.status_changed";
  intentId: string;
  status: "approved" | "failed" | "expired" | "pending";
  merchantId: string;
  at: string;
}

function urlToWs(baseUrl: string): string {
  if (baseUrl.startsWith("https://")) {
    return baseUrl.replace("https://", "wss://");
  }
  if (baseUrl.startsWith("http://")) {
    return baseUrl.replace("http://", "ws://");
  }
  return baseUrl;
}

export function connectPaymentWs(options: PaymentWsOptions): () => void {
  const { apiBaseUrl, token, intentId, onApproved, onFailed, onError } = options;

  if (typeof WebSocket === "undefined") {
    onError();
    return () => {};
  }

  const wsUrl = `${urlToWs(apiBaseUrl)}/ws?token=${encodeURIComponent(token)}`;
  let ws: WebSocket | null = null;

  try {
    ws = new WebSocket(wsUrl);

    ws.addEventListener("open", () => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ event: "subscribe", intentId }));
      }
    });

    ws.addEventListener("message", (evt) => {
      try {
        const msg = JSON.parse(evt.data) as PaymentStatusMessage;
        if (msg.event === "payment.status_changed") {
          if (msg.status === "approved") {
            onApproved();
          } else if (msg.status === "failed" || msg.status === "expired") {
            onFailed();
          }
        }
      } catch {
      }
    });

    ws.addEventListener("error", () => {
      onError();
    });

    ws.addEventListener("close", () => {
      onError();
    });
  } catch {
    onError();
  }

  return () => {
    if (ws) {
      ws.close();
      ws = null;
    }
  };
}
