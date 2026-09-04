const isProd = process.env.NODE_ENV === "production";

export function isMercadoPagoOAuthConfigured(): boolean {
  return Boolean(readMercadoPagoOAuthConfig().appId);
}

export function readMercadoPagoOAuthConfig(): {
  appId: string | undefined;
  clientSecret: string | undefined;
  redirectUri: string | undefined;
} {
  if (isProd) {
    return {
      appId: process.env.MERCADOPAGO_OAUTH_APP_ID?.trim() || undefined,
      clientSecret: process.env.MERCADOPAGO_OAUTH_CLIENT_SECRET?.trim() || undefined,
      redirectUri: process.env.MERCADOPAGO_OAUTH_REDIRECT_URI?.trim() || undefined,
    };
  }

  // dev / test: prefer _TEST keys; fall back to prod when explicitly set
  const testAppId = process.env.MERCADOPAGO_OAUTH_APP_ID_TEST?.trim();
  const testClientSecret = process.env.MERCADOPAGO_OAUTH_CLIENT_SECRET_TEST?.trim();
  const testRedirectUri = process.env.MERCADOPAGO_OAUTH_REDIRECT_URI_TEST?.trim();

  const prodAppId = process.env.MERCADOPAGO_OAUTH_APP_ID?.trim();
  const prodClientSecret = process.env.MERCADOPAGO_OAUTH_CLIENT_SECRET?.trim();
  const prodRedirectUri = process.env.MERCADOPAGO_OAUTH_REDIRECT_URI?.trim();

  return {
    appId: testAppId || prodAppId || undefined,
    clientSecret: testClientSecret || prodClientSecret || undefined,
    redirectUri: testRedirectUri || prodRedirectUri || undefined,
  };
}
