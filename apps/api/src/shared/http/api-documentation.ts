import type { INestApplication } from "@nestjs/common";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import type {
  OpenAPIObject,
  OperationObject,
  PathItemObject,
} from "@nestjs/swagger/dist/interfaces/open-api-spec.interface.js";
import { apiReference } from "@scalar/nestjs-api-reference";
import type { NextFunction, Request, Response } from "express";
import { PUBLIC_API_PREFIX } from "./api-versioning.js";
import { createPostmanCollection } from "./postman-collection.js";

const HTTP_METHODS = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "options",
  "head",
] as const;

type HttpMethod = (typeof HTTP_METHODS)[number];

type PublicOperationRule = {
  methods: readonly HttpMethod[];
  path: RegExp;
  security: "none" | "session" | "service" | "tenant" | "human";
};

const PUBLIC_OPERATIONS: readonly PublicOperationRule[] = [
  { methods: ["post"], path: /^\/auth\/(register|login)$/, security: "none" },
  { methods: ["post"], path: /^\/auth\/(refresh|logout)$/, security: "session" },
  { methods: ["get", "put"], path: /^\/merchants\/me(?:\/.*)?$/, security: "session" },
  { methods: ["get", "put"], path: /^\/agent-rules(?:\/.*)?$/, security: "session" },
  { methods: ["get", "post", "put"], path: /^\/checkout-settings(?:\/.*)?$/, security: "tenant" },
  { methods: ["post"], path: /^\/embed\/sessions$/, security: "tenant" },
  { methods: ["get", "post", "put"], path: /^\/installations(?:\/.*)?$/, security: "tenant" },
  { methods: ["get", "post", "put", "patch"], path: /^\/orders(?:\/.*)?$/, security: "tenant" },
  { methods: ["get"], path: /^\/customers(?:\/.*)?$/, security: "tenant" },
  { methods: ["get"], path: /^\/payments(?:\/(?!connections(?:\/|$))[^/]+)?$/, security: "tenant" },
  { methods: ["get"], path: /^\/audit-events$/, security: "tenant" },
  { methods: ["get", "post", "put"], path: /^\/webhook-endpoints(?:\/.*)?$/, security: "tenant" },
  {
    methods: ["get", "post", "delete"],
    path: /^\/integrations\/api-keys(?:\/[^/]+(?:\/rotate)?)?$/,
    security: "human",
  },
  { methods: ["get", "post", "delete"], path: /^\/commerce\/connections(?:\/.*)?$/, security: "tenant" },
  { methods: ["get"], path: /^\/catalog(?:\/.*)?$/, security: "tenant" },
  { methods: ["get", "post"], path: /^\/payments\/connections(?:\/.*)?$/, security: "human" },
  { methods: ["get", "post"], path: /^\/billing(?:\/.*)?$/, security: "human" },
  { methods: ["get", "put"], path: /^\/support\/settings$/, security: "tenant" },
  { methods: ["get", "post", "patch"], path: /^\/support\/tickets(?:\/.*)?$/, security: "tenant" },
  { methods: ["get", "post"], path: /^\/onboarding(?:\/.*)?$/, security: "session" },
  // Public API v1 — Checkouts
  { methods: ["post"], path: /^\/checkouts$/, security: "tenant" },
  { methods: ["get"], path: /^\/checkouts\/[^/]+$/, security: "tenant" },
  { methods: ["post"], path: /^\/checkouts\/[^/]+\/events$/, security: "tenant" },
  { methods: ["post"], path: /^\/checkouts\/[^/]+\/messages$/, security: "tenant" },
  { methods: ["post"], path: /^\/checkouts\/[^/]+\/shipping\/evaluate$/, security: "tenant" },
  { methods: ["post"], path: /^\/checkouts\/[^/]+\/offers$/, security: "tenant" },
  { methods: ["post"], path: /^\/checkouts\/[^/]+\/complete$/, security: "tenant" },
  { methods: ["patch"], path: /^\/checkouts\/[^/]+\/cart$/, security: "tenant" },
  // Public API v1 — Products
  { methods: ["get", "post"], path: /^\/products$/, security: "tenant" },
  { methods: ["get", "patch", "delete"], path: /^\/products\/[^/]+$/, security: "tenant" },
  // Public API v1 — Settings
  { methods: ["get", "put"], path: /^\/settings\/checkout$/, security: "tenant" },
  { methods: ["get", "put"], path: /^\/settings\/agent-rules$/, security: "tenant" },
  { methods: ["get", "put"], path: /^\/settings\/store$/, security: "tenant" },
  { methods: ["get", "put"], path: /^\/settings\/seo$/, security: "tenant" },
  // Public API v1 — Payments
  { methods: ["post"], path: /^\/payments\/intents$/, security: "tenant" },
  { methods: ["get"], path: /^\/payments\/intents\/[^/]+$/, security: "tenant" },
  { methods: ["post"], path: /^\/payments\/intents\/[^/]+\/confirm$/, security: "tenant" },
  // Public API v1 — Categories
  { methods: ["get", "post"], path: /^\/categories$/, security: "tenant" },
  { methods: ["get", "patch", "delete"], path: /^\/categories\/[^/]+$/, security: "tenant" },
  { methods: ["put"], path: /^\/categories\/reorder$/, security: "tenant" },
  // Public API v1 — Webhooks
  { methods: ["get", "post"], path: /^\/webhooks$/, security: "tenant" },
  { methods: ["get", "put", "delete"], path: /^\/webhooks\/[^/]+$/, security: "tenant" },
  { methods: ["post"], path: /^\/webhooks\/[^/]+\/test$/, security: "tenant" },
  // Public API v1 — Coupons
  { methods: ["get", "post"], path: /^\/coupons$/, security: "tenant" },
  { methods: ["patch", "delete"], path: /^\/coupons\/[^/]+$/, security: "tenant" },
  { methods: ["post"], path: /^\/coupons\/[^/]+\/validate$/, security: "tenant" },
  // Public API v1 — Analytics
  { methods: ["get"], path: /^\/analytics\/dashboard$/, security: "tenant" },
  { methods: ["get"], path: /^\/analytics\/products(?:\/[^/]+)?$/, security: "tenant" },
  { methods: ["get"], path: /^\/analytics\/offers\/roi$/, security: "tenant" },
  { methods: ["get"], path: /^\/analytics\/payments$/, security: "tenant" },
  { methods: ["get"], path: /^\/analytics\/customers$/, security: "tenant" },
  // Public API v1 — Team
  { methods: ["get"], path: /^\/team\/members$/, security: "tenant" },
  { methods: ["post"], path: /^\/team\/invitations$/, security: "tenant" },
  { methods: ["post"], path: /^\/team\/invitations\/[^/]+\/accept$/, security: "tenant" },
  { methods: ["patch"], path: /^\/team\/members\/[^/]+\/role$/, security: "tenant" },
  { methods: ["delete"], path: /^\/team\/members\/[^/]+$/, security: "tenant" },
  // Public API v1 — Returns
  { methods: ["get", "post"], path: /^\/returns$/, security: "tenant" },
  // Public API v1 — Experiments
  { methods: ["get", "post"], path: /^\/experiments$/, security: "tenant" },
  { methods: ["get", "patch"], path: /^\/experiments\/[^/]+$/, security: "tenant" },
  { methods: ["post"], path: /^\/experiments\/[^/]+\/start$/, security: "tenant" },
  { methods: ["post"], path: /^\/experiments\/[^/]+\/stop$/, security: "tenant" },
  { methods: ["post"], path: /^\/experiments\/[^/]+\/archive$/, security: "tenant" },
  { methods: ["get"], path: /^\/experiments\/[^/]+\/results$/, security: "tenant" },
  { methods: ["post"], path: /^\/experiments\/[^/]+\/promote$/, security: "tenant" },
  // Public API v1 — Domains
  { methods: ["get", "post"], path: /^\/domains$/, security: "tenant" },
  { methods: ["post"], path: /^\/domains\/[^/]+\/verify$/, security: "tenant" },
  // Public API v1 — Support
  { methods: ["get"], path: /^\/support\/settings$/, security: "tenant" },
  { methods: ["get"], path: /^\/support\/tickets$/, security: "tenant" },
  // Public API v1 — Shipping
  { methods: ["post"], path: /^\/shipping\/quotes$/, security: "tenant" },
  // Public API v1 — Fulfillment
  { methods: ["post"], path: /^\/fulfillment\/shipments$/, security: "tenant" },
  { methods: ["get"], path: /^\/fulfillment\/shipments$/, security: "tenant" },
  // Public API v1 — Notifications
  { methods: ["post"], path: /^\/notifications\/order-confirmation$/, security: "tenant" },
  { methods: ["post"], path: /^\/notifications\/order-shipped$/, security: "tenant" },
  { methods: ["post"], path: /^\/notifications\/order-delivered$/, security: "tenant" },
  { methods: ["post"], path: /^\/notifications\/return-approved$/, security: "tenant" },
  // Public API v1 — Cross-Sell
  { methods: ["get", "post"], path: /^\/cross-sells$/, security: "tenant" },
  { methods: ["get"], path: /^\/cross-sells\/eligible$/, security: "tenant" },
];

const SCALAR_CSS = `
:root {
  --aacp-accent: oklch(45% 0.11 153);
  --aacp-accent-dark: oklch(77% 0.13 176);
}

.light-mode {
  --scalar-color-1: oklch(23% 0.022 155);
  --scalar-color-2: oklch(47% 0.018 155);
  --scalar-color-3: oklch(61% 0.014 155);
  --scalar-color-accent: var(--aacp-accent);
  --scalar-background-1: oklch(99.2% 0.006 100);
  --scalar-background-2: oklch(97.4% 0.012 102);
  --scalar-background-3: oklch(92.8% 0.018 112);
  --scalar-background-accent: oklch(94% 0.035 150);
  --scalar-border-color: oklch(85.5% 0.018 108);
}

.dark-mode {
  --scalar-color-1: oklch(94% 0.009 105);
  --scalar-color-2: oklch(73% 0.012 120);
  --scalar-color-3: oklch(61% 0.012 120);
  --scalar-color-accent: var(--aacp-accent-dark);
  --scalar-background-1: oklch(16.5% 0.014 160);
  --scalar-background-2: oklch(20.5% 0.016 158);
  --scalar-background-3: oklch(29% 0.019 152);
  --scalar-background-accent: oklch(27% 0.035 168);
  --scalar-border-color: oklch(38% 0.018 150);
}

.light-mode .t-doc__sidebar,
.dark-mode .t-doc__sidebar {
  --scalar-sidebar-background-1: var(--scalar-background-1);
  --scalar-sidebar-item-hover-background: var(--scalar-background-2);
  --scalar-sidebar-item-active-background: var(--scalar-background-3);
  --scalar-sidebar-border-color: var(--scalar-border-color);
  --scalar-sidebar-color-1: var(--scalar-color-1);
  --scalar-sidebar-color-2: var(--scalar-color-2);
  --scalar-sidebar-color-active: var(--scalar-color-1);
  --scalar-sidebar-search-background: var(--scalar-background-2);
  --scalar-sidebar-search-border-color: var(--scalar-border-color);
}

body {
  font-family: "IBM Plex Sans", "Segoe UI", system-ui, sans-serif;
}
`;

export function configureApiDocumentation(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("AACP Integration API")
    .setDescription(
      "Public API for merchant configuration, checkout integrations and operational workflows. "
      + "All tenant access is derived from the authenticated credential.",
    )
    .setVersion("1.0.0")
    .addServer(
      apiOrigin(
        process.env.AACP_SANDBOX_API_URL
        ?? "https://sandbox-api.aacp.dev",
      ),
      "Sandbox",
    )
    .addServer(
      apiOrigin(
        process.env.AACP_PRODUCTION_API_URL ?? "https://api.aacp.dev",
      ),
      "Production",
    )
    .addBearerAuth(
      {
        type: "http",
        scheme: "bearer",
        bearerFormat: "aacp_test_* or aacp_live_*",
        description: "Service API key issued by the merchant console.",
      },
      "service_api_key",
    )
    .addCookieAuth(
      "aacp_access_token",
      {
        type: "apiKey",
        in: "cookie",
        description: "Short-lived HttpOnly merchant console session.",
      },
      "console_session",
    )
    .addApiKey(
      {
        type: "apiKey",
        in: "header",
        name: "x-aacp-api-key",
        description: "Deprecated compatibility header. Prefer Bearer authentication.",
      },
      "legacy_api_key",
    )
    .build();

  let generated: any;
  try {
    generated = SwaggerModule.createDocument(app, config, {
      deepScanRoutes: true,
      operationIdFactory: (controllerKey, methodKey) =>
        `${controllerKey.replace(/Controller$/, "")}_${methodKey}`,
    });
  } catch (err: any) {
    // Swagger circular dependency in DTOs — non-blocking, generate without deep scan
    generated = SwaggerModule.createDocument(app, config, {
      deepScanRoutes: false,
      operationIdFactory: (controllerKey, methodKey) =>
        `${controllerKey.replace(/Controller$/, "")}_${methodKey}`,
    });
    console.warn(`[Swagger] Fallback to shallow scan: ${err.message}`);
  }
  const publicDocument = createPublicApiDocument(generated);

  SwaggerModule.setup("docs", app, publicDocument, {
    ui: false,
    raw: ["json"],
    jsonDocumentUrl: "openapi.json",
  });

  const postmanCollection = createPostmanCollection(publicDocument);
  app.use(
    "/postman.json",
    (request: Request, response: Response, next: NextFunction) => {
      if (request.method !== "GET") {
        next();
        return;
      }
      response.setHeader(
        "Content-Disposition",
        'attachment; filename="aacp-integration-api.postman_collection.json"',
      );
      response.setHeader("Cache-Control", "public, max-age=300");
      response.type("application/json").send(postmanCollection);
    },
  );

  app.use(
    "/docs",
    scalarSecurityHeaders,
    apiReference({
      url: "/openapi.json",
      pageTitle: "AACP Integration API",
      theme: "none",
      customCss: SCALAR_CSS,
      layout: "modern",
      hideModels: false,
      persistAuth: false,
      telemetry: false,
      defaultHttpClient: {
        targetKey: "shell",
        clientKey: "curl",
      },
      documentDownloadType: "both",
    }),
  );

  return publicDocument;
}

export function createPublicApiDocument(document: OpenAPIObject): OpenAPIObject {
  const paths: OpenAPIObject["paths"] = {};

  for (const [path, pathItem] of Object.entries(document.paths)) {
    const filtered = filterPublicPathItem(path, pathItem);
    if (filtered) {
      paths[`${PUBLIC_API_PREFIX}${path}`] = filtered;
    }
  }

  return {
    ...document,
    components: {
      ...document.components,
      schemas: {
        ...document.components?.schemas,
        ProblemDetails: {
          type: "object",
          required: [
            "type",
            "title",
            "status",
            "code",
            "correlation_id",
          ],
          properties: {
            type: { type: "string", format: "uri" },
            title: { type: "string" },
            status: { type: "integer", minimum: 400, maximum: 599 },
            code: { type: "string" },
            detail: { type: "string" },
            fields: {
              type: "object",
              additionalProperties: {
                type: "array",
                items: { type: "string" },
              },
            },
            correlation_id: { type: "string" },
          },
        },
      },
    },
    paths,
  };
}

function filterPublicPathItem(
  path: string,
  pathItem: PathItemObject,
): PathItemObject | null {
  const filtered: PathItemObject = {
    ...(pathItem.parameters ? { parameters: pathItem.parameters } : {}),
  };

  for (const method of HTTP_METHODS) {
    const operation = pathItem[method];
    const rule = operation ? publicOperationRule(method, path) : undefined;
    if (!operation || !rule) {
      continue;
    }

    filtered[method] = withPublicHttpContract(
      operation,
      rule.security,
      method,
      path,
    );
  }

  return HTTP_METHODS.some((method) => Boolean(filtered[method]))
    ? filtered
    : null;
}

function publicOperationRule(
  method: HttpMethod,
  path: string,
): PublicOperationRule | undefined {
  return PUBLIC_OPERATIONS.find(
    (rule) => rule.methods.includes(method) && rule.path.test(path),
  );
}

function withPublicHttpContract(
  operation: OperationObject,
  security: PublicOperationRule["security"],
  method: HttpMethod,
  path: string,
): OperationObject {
  const parameters = [...(operation.parameters ?? [])];
  if (requiresIdempotency(method, path)) {
    parameters.push({
      in: "header",
      name: "Idempotency-Key",
      required: true,
      description:
        "Unique key for safely retrying this mutation. Reuse with a different payload returns 409.",
      schema: { type: "string", minLength: 8, maxLength: 255 },
    });
  }
  if (requiresIfMatch(method, path)) {
    parameters.push({
      in: "header",
      name: "If-Match",
      required: true,
      description: "ETag returned by the latest configuration read.",
      schema: { type: "string" },
    });
  }

  const responses: OperationObject["responses"] = {
    ...operation.responses,
    default: {
      description: "RFC 7807 error response.",
      content: {
        "application/problem+json": {
          schema: { $ref: "#/components/schemas/ProblemDetails" },
        },
      },
    },
  };

  if (
    path.startsWith("/checkout-settings") ||
    path.startsWith("/webhook-endpoints") ||
    path.startsWith("/settings")
  ) {
    for (const response of Object.values(responses)) {
      if (!response || "$ref" in response) continue;
      response.headers = {
        ...response.headers,
        ETag: {
          description: "Opaque version of the returned configuration.",
          schema: { type: "string" },
        },
      };
    }
  }

  const contracted = {
    ...operation,
    ...(parameters.length > 0 ? { parameters } : {}),
    responses,
  };

  if (security === "none") {
    return { ...contracted, security: [] };
  }

  return {
    ...contracted,
    security:
      security === "session" || security === "human"
        ? [{ console_session: [] }]
        : security === "tenant"
          ? [
              { console_session: [] },
              { service_api_key: [] },
              { legacy_api_key: [] },
            ]
          : [{ service_api_key: [] }, { legacy_api_key: [] }],
  };
}

function requiresIdempotency(method: HttpMethod, path: string): boolean {
  return (
    ["post", "put", "patch", "delete"].includes(method) &&
    (path.startsWith("/integrations") ||
      path.startsWith("/commerce/connections") ||
      path.startsWith("/payments/connections") ||
      path.startsWith("/billing") ||
      path.startsWith("/installations") ||
      path.startsWith("/webhook-endpoints") ||
      path === "/support/settings" ||
      path.startsWith("/support/tickets") ||
      path === "/embed-sessions" ||
      path === "/embed/sessions" ||
      path.startsWith("/orders") ||
      path === "/checkout-settings" ||
      path === "/checkout-settings/reset")
  );
}

function requiresIfMatch(method: HttpMethod, path: string): boolean {
  return (
    (method === "put" && path === "/checkout-settings") ||
    (method === "post" && path === "/checkout-settings/reset") ||
    (method === "put" && path === "/settings/store") ||
    (method === "put" && path === "/settings/seo") ||
    (method === "put" && /^\/installations\/[^/]+$/.test(path)) ||
    (method === "put" && /^\/webhook-endpoints\/[^/]+$/.test(path))
  );
}

function scalarSecurityHeaders(
  _request: Request,
  response: Response,
  next: NextFunction,
): void {
  response.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'none'",
      "base-uri 'none'",
      "frame-ancestors 'none'",
      "img-src 'self' data: https:",
      "font-src 'self' data:",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
      "connect-src 'self' https://sandbox-api.aacp.dev https://api.aacp.dev",
    ].join("; "),
  );
  response.setHeader("Cache-Control", "no-store");
  next();
}

function apiOrigin(value: string): string {
  return value.replace(/\/+$/, "").replace(/\/v1$/, "");
}
