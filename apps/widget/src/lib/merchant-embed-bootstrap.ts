import type { CheckoutEventName } from "@zyon/shared-types";
import { AgenticCheckoutEmbedClient } from "@zyon/agentic-checkout-js";
import { emitCheckoutEvent, renderConversationalCheckoutChrome, type HybridCheckoutOptions } from "./merchant-checkout-shell.js";
import { readMerchantEmbedOptions } from "./merchant-embed-config.js";
import "../main.js";

const WIDGET_CE = "zyon-checkout-agent";

function attachWidget(opts: HybridCheckoutOptions): void {
  document.querySelectorAll(WIDGET_CE).forEach((n) => n.remove());

  const el = document.createElement(WIDGET_CE);
  el.setAttribute("ui-presentation", "conversational");
  el.setAttribute("merchant-id", opts.merchantId);
  el.setAttribute("api-base-url", opts.apiBaseUrl);
  el.setAttribute("cart-json", JSON.stringify(opts.cart));
  if (opts.productApiBaseUrl) el.setAttribute("product-api-base-url", opts.productApiBaseUrl);
  if (opts.productSelection?.length) el.setAttribute("product-selection-json", JSON.stringify(opts.productSelection));
  if (opts.customer) el.setAttribute("customer-json", JSON.stringify(opts.customer));
  if (opts.shipping) el.setAttribute("shipping-json", JSON.stringify(opts.shipping));

  if (opts.embedSessionToken) {
    el.setAttribute("embed-session-token", opts.embedSessionToken);
  }
  if (opts.storeUrl) {
    el.setAttribute("store-url", opts.storeUrl);
  }
  if (opts.brandTitle) {
    el.setAttribute("store-name", opts.brandTitle);
  }

  const chatMount = document.getElementById("aacp-chat-mount");
  if (chatMount) {
    chatMount.appendChild(el);
  } else {
    document.body.appendChild(el);
  }
}

function exposeGlobal(namespace: HybridCheckoutOptions): void {
  const w = window as typeof window & {
    AACP?: {
      VERSION: string;
      AgenticCheckoutEmbedClient: typeof AgenticCheckoutEmbedClient;
      track: (event: CheckoutEventName) => void;
      options: HybridCheckoutOptions;
    };
  };

  w.AACP = {
    VERSION: "0.1.0",
    AgenticCheckoutEmbedClient,
    track: emitCheckoutEvent,
    options: { ...namespace }
  };
}

async function acquireDevEmbedToken(opts: HybridCheckoutOptions): Promise<void> {
  if (opts.embedSessionToken) return;
  if (typeof window === "undefined") return;
  const isDev = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (!isDev || !opts.apiBaseUrl) return;

  try {
    const res = await fetch(`${opts.apiBaseUrl}/embed-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        ttl_seconds: 86400,
        allowed_origin: window.location.origin,
        cart_ref: "dev-cart",
      }),
    });
    if (res.ok) {
      const data = await res.json() as { token?: string; embed_session_token?: string };
      const token = data.token ?? data.embed_session_token;
      if (token) {
        opts.embedSessionToken = token;
        return;
      }
    }
  } catch {
    // Merchant auth may not be available; rely on dev bypass in the guard.
  }

  // Dev fallback: set a placeholder so PulseAPI sends the x-aacp-embed-token header.
  // The API dev bypass (NODE_ENV=development) will handle authentication.
  opts.embedSessionToken = "__dev_bypass__";
}

async function bootstrap(): Promise<void> {
  const mount = document.getElementById("aacp-merchant-mount");
  if (!mount) {
    console.error('[AACP embed] elemento "#aacp-merchant-mount" em falta');
    return;
  }

  const opts = readMerchantEmbedOptions(mount);
  await acquireDevEmbedToken(opts);
  renderConversationalCheckoutChrome(mount, opts);
  exposeGlobal(opts);
  attachWidget(opts);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => void bootstrap());
} else {
  void bootstrap();
}
