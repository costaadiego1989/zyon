export function melhorEnvioBaseUrl(): string {
  const configured = process.env.MELHOR_ENVIO_BASE_URL?.trim().replace(/\/+$/, "")
    || "https://sandbox.melhorenvio.com.br";
  // The production OAuth and REST endpoints share the documented root domain.
  return configured === "https://api.melhorenvio.com.br"
    ? "https://melhorenvio.com.br"
    : configured;
}

export const MELHOR_ENVIO_USER_AGENT = "Zyon/1.0 (pedidos@zyon-payments.com.br)";
