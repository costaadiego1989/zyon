const DEFAULT_MERCADOPAGO_SANDBOX_ORIGIN = "https://api.mercadopago.com";
const DEFAULT_MERCADOPAGO_PRODUCTION_ORIGIN = "https://api.mercadopago.com";

function normalizeBaseOrigin(raw: string): string {
  let v = raw.trim();
  v = v.split("?")[0]!.split("#")[0]!;
  v = v.replace(/\/+$/, "");
  return v;
}

/** Detects production vs sandbox from the URL or token prefix. */
function isProductionOrigin(origin: string): boolean {
  try {
    const host = new URL(origin).hostname.toLowerCase();
    return host === "api.mercadopago.com";
  } catch {
    return false;
  }
}

export function parseMercadoPagoSandboxEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  // A non-production API must never fall back to an unprefixed (live) token.
  // Test credentials can use Mercado Pago's normal API origin, but are selected
  // exclusively through the *_SANDBOX variables.
  if (env.NODE_ENV !== "production") return true;
  const v = env.MERCADOPAGO_SANDBOX?.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes";
}

/** Origin — the adapter handles `/v1` paths internally. */
export function readMercadoPagoConnection(env: NodeJS.ProcessEnv = process.env): {
  sandbox: boolean;
  accessToken: string | undefined;
  publicKey: string | undefined;
  baseUrl: string;
} {
  const sandbox = parseMercadoPagoSandboxEnv(env);

  const accessToken = sandbox
    ? env.MERCADOPAGO_ACCESS_TOKEN_SANDBOX?.trim()
    : env.MERCADOPAGO_ACCESS_TOKEN?.trim();

  const publicKey = sandbox
    ? env.MERCADOPAGO_PUBLIC_KEY_SANDBOX?.trim()
    : env.MERCADOPAGO_PUBLIC_KEY?.trim();

  const rawOverride =
    env.MERCADOPAGO_API_BASE_URL?.trim() ||
    env.MERCADOPAGO_BASE_URL?.trim();

  const baseUrl = rawOverride
    ? normalizeBaseOrigin(rawOverride)
    : DEFAULT_MERCADOPAGO_SANDBOX_ORIGIN;

  return {
    sandbox,
    accessToken: accessToken || undefined,
    publicKey: publicKey || undefined,
    baseUrl
  };
}

export function isMercadoPagoConfigured(): boolean {
  const { accessToken } = readMercadoPagoConnection();
  return Boolean(accessToken);
}
