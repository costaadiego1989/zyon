export function widgetV2Base(): string {
  return (import.meta.env.VITE_WIDGET_V2_URL?.trim() ||
    (import.meta.env.DEV ? "http://localhost:5174" : "https://widget.zyon-payments.com.br")).replace(/\/+$/, "");
}

export function widgetV2Snippet(options: {
  apiBaseUrl: string;
  merchantId?: string;
  token?: string;
  cartRef?: string;
}): string {
  const url = new URL(widgetV2Base());
  url.searchParams.set("merchantId", options.merchantId || "SEU_MERCHANT_ID");
  url.searchParams.set("embedToken", options.token || "TOKEN_DO_SEU_BACKEND");
  url.searchParams.set("apiBaseUrl", options.apiBaseUrl.replace(/\/+$/, ""));
  if (options.cartRef) url.searchParams.set("cartRef", options.cartRef);
  const src = url.toString().replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<!-- Gere um token por checkout no backend: POST /embed-sessions.\n     Use allowed_origin: ${url.origin}. Mantenha a API key apenas no backend. -->\n<iframe\n  src="${src}"\n  title="Checkout Zyon"\n  style="width:100%;height:760px;border:0"\n  allow="payment"\n  referrerpolicy="no-referrer"\n></iframe>`;
}
