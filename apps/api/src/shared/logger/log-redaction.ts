export const REDACTED_LOG_PATHS = [
  "req.headers.authorization",
  "req.headers['x-buyer-authorization']",
  "req.headers['x-ai-user-token']",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "req.headers['x-webhook-secret']",
  "req.headers['x-twilio-signature']",
  "req.headers['x-internal-service-token']",
  "req.headers['asaas-access-token']",
  "req.headers['stripe-signature']",
  "req.body.password",
  "req.body.images",
  "req.body.imageUrls",
  "req.body.notes",
  "req.body.content",
  "req.body.description",
  "req.query.access_token",
  "req.body.code",
  "req.body.otp",
  "req.body.token",
  "req.body.buyer_access_token",
  "req.body.webhookSecret",
  "req.body.creditCard",
  "req.body.cvv",
  "req.body.ccv",
  "req.body.email",
  "req.body.cpf",
  "req.body.phone",
  "req.body.customer.email",
  "req.body.customer.cpf",
  "req.body.customer.phone",
  "req.body.customer.fullName",
  "req.body.customer.address",
  "req.body.address",
  "req.body.display_name",
  "req.body.mobile_phone",
  "req.body.cpf_cnpj",
  "res.body.access_token",
  "res.body.embed_session_token",
  "res.body.email",
  "res.body.cpf",
  "res.body.phone",
  "res.body.customer",
  ...["", "req.body.", "res.body.", "err.", "error."].flatMap(prefix => [
    "credential", "credentialCipher", "setupCipher", "focusWebhook", "privateReceipt",
    "certificate", "certificatePassword", "a1", "password", "fiscalPayload", "rawBody", "rawConfig", "clientSecret", "notificationToken",
  ].map(field => prefix + field)),
];

// pino supplies a serialized copy. Never change the URL used by the router.
export function redactRequestUrl<T extends { url?: string; [key: string]: unknown }>(req: T) {
  return { ...req, url: req.url?.replace(/([?&](?:access_token|token|buyer_access_token)=)[^&#]*/gi, "$1[redacted]") };
}

/** Pino receives a serialized copy. Fiscal callback headers are configurable, so
 * every value on those paths is private; never mutate the authenticating request. */
export function redactFiscalLogRequest<T extends { url?: string; originalUrl?: string; query?: unknown; headers?: Record<string, unknown>; body?: unknown }>(request: T): T {
  if (!isFiscalCallbackLogPath(request.url) && !isOlistPrivateLogPath(request.url)) return request;
  const url = isOlistPrivateLogPath(request.url) || /\/webhooks\/fiscal\/olist\//i.test(request.url ?? "") ? request.url?.split("?", 1)[0] : request.url;
  return { ...request, url, ...(request.originalUrl === undefined ? {} : { originalUrl: request.originalUrl.split("?", 1)[0] }),
    ...(request.query === undefined ? {} : { query: "[redacted]" }), headers: Object.fromEntries(Object.keys(request.headers ?? {}).map(name => [name, "[redacted]"])), ...(request.body === undefined ? {} : { body: "[redacted]" }) };
}
function isOlistPrivateLogPath(url: string | undefined): boolean {
  return /^\/(?:v1\/)?merchants\/me\/fiscal\/olist\//i.test((url ?? "").split("?", 1)[0]!);
}
/** Sentry attaches its own request context, independently of Pino serializers. */
export function redactFiscalTelemetryRequest<T extends { request?: { url?: string; query_string?: unknown; data?: unknown; headers?: unknown; cookies?: unknown } }>(event: T): T {
  const request = event.request;
  if (!request?.url) return event;
  let path: string;
  try { path = new URL(request.url, "https://local.invalid").pathname; } catch { return event; }
  if (!isFiscalCallbackLogPath(path) && !isOlistPrivateLogPath(path)) return event;
  return { ...event, request: { ...request, url: request.url.split("?", 1)[0], query_string: undefined, data: undefined, headers: {}, cookies: undefined } };
}
export function isFiscalCallbackLogPath(url: string | undefined): boolean {
  return /^\/(?:v1\/)?webhooks\/fiscal(?:-delivery)?(?:\/|$)/i.test((url ?? "").split("?", 1)[0]!);
}
export function redactFiscalLogResponse<T extends { headers?: Record<string, unknown>; body?: unknown; raw?: { req?: { url?: string } } }>(response: T): T {
  if (!isFiscalCallbackLogPath(response.raw?.req?.url) && !isOlistPrivateLogPath(response.raw?.req?.url)) return response;
  return { ...response, headers: Object.fromEntries(Object.keys(response.headers ?? {}).map(name => [name, "[redacted]"])), ...(response.body === undefined ? {} : { body: "[redacted]" }) };
}
