export const DEFAULT_API_BASE = (
  import.meta.env.VITE_API_BASE_URL?.trim()
  || (import.meta.env.DEV ? "http://localhost:3009" : "https://api.zyon-payments.com.br")
).replace(/\/+$/, "");
