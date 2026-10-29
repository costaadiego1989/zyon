import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  ReferenceObject,
  SchemaObject,
} from "@nestjs/swagger/dist/interfaces/open-api-spec.interface.js";

type PostmanHeader = {
  key: string;
  value: string;
  description?: string;
  type?: "text";
};

type PostmanVariable = {
  key: string;
  value: string;
  description?: string;
  type?: "string";
};

type PostmanItem = {
  name: string;
  request: {
    auth?: { type: "noauth" };
    body?: {
      mode: "raw";
      raw: string;
      options: { raw: { language: "json" } };
    };
    description?: string;
    header: PostmanHeader[];
    method: string;
    url: {
      raw: string;
      host: string[];
      path: string[];
      query?: Array<{ key: string; value: string; description?: string }>;
      variable?: PostmanVariable[];
    };
  };
};

export type PostmanCollection = {
  info: {
    _postman_id: string;
    name: string;
    description: string;
    schema: string;
  };
  auth: {
    type: "bearer";
    bearer: Array<{ key: "token"; value: "{{apiKey}}"; type: "string" }>;
  };
  variable: PostmanVariable[];
  item: Array<{ name: string; item: PostmanItem[] }>;
};

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

export function createPostmanCollection(
  document: OpenAPIObject,
): PostmanCollection {
  const folders = new Map<string, PostmanItem[]>();

  for (const [path, pathItem] of Object.entries(document.paths)) {
    for (const method of METHODS) {
      const operation = pathItem[method];
      if (!operation) continue;

      const folder = operation.tags?.[0] ?? "API";
      const items = folders.get(folder) ?? [];
      items.push(toPostmanItem(document, path, method, operation));
      folders.set(folder, items);
    }
  }

  return {
    info: {
      _postman_id: "aacp-integration-api-v1",
      name: `${document.info.title} ${document.info.version}`,
      description:
        document.info.description
        ?? "AACP Integration API collection generated from OpenAPI.",
      schema:
        "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    auth: {
      type: "bearer",
      bearer: [{ key: "token", value: "{{apiKey}}", type: "string" }],
    },
    variable: [
      {
        key: "baseUrl",
        value: document.servers?.[0]?.url ?? "https://sandbox-api.aacp.dev",
        description: "Sandbox or production API origin.",
        type: "string",
      },
      {
        key: "apiKey",
        value: "aacp_test_replace_me",
        description: "Service API key created in the Merchant Console.",
        type: "string",
      },
      {
        key: "etag",
        value: "*",
        description: "Latest ETag returned by a configuration read.",
        type: "string",
      },
    ],
    item: [...folders.entries()].map(([name, item]) => ({ name, item })),
  };
}

function toPostmanItem(
  document: OpenAPIObject,
  path: string,
  method: (typeof METHODS)[number],
  operation: OperationObject,
): PostmanItem {
  const parameters = (operation.parameters ?? []).filter(
    (parameter): parameter is ParameterObject => !isReference(parameter),
  );
  const pathVariables = parameters
    .filter((parameter) => parameter.in === "path")
    .map((parameter) => ({
      key: parameter.name,
      value: `replace-${parameter.name}`,
      description: parameter.description,
      type: "string" as const,
    }));
  const query = parameters
    .filter((parameter) => parameter.in === "query")
    .map((parameter) => ({
      key: parameter.name,
      value: parameter.required ? `{{${parameter.name}}}` : "",
      description: parameter.description,
    }));
  const headers = parameters
    .filter((parameter) => parameter.in === "header")
    .map(toPostmanHeader);
  const body = requestBodyExample(document, operation);
  if (body !== undefined) {
    headers.push({ key: "Content-Type", value: "application/json" });
  }

  const requestPath = path.replace(
    /\{([^}]+)\}/g,
    (_match, name: string) => `:${name}`,
  );

  return {
    name: operation.summary ?? operation.operationId ?? `${method} ${path}`,
    request: {
      ...(operation.security?.length === 0 || usesOnlyCookieAuth(operation)
        ? { auth: { type: "noauth" as const } }
        : {}),
      ...(body !== undefined
        ? {
            body: {
              mode: "raw" as const,
              raw: JSON.stringify(body, null, 2),
              options: { raw: { language: "json" as const } },
            },
          }
        : {}),
      ...(operation.description ? { description: operation.description } : {}),
      header: headers,
      method: method.toUpperCase(),
      url: {
        raw: `{{baseUrl}}${requestPath}`,
        host: ["{{baseUrl}}"],
        path: requestPath.split("/").filter(Boolean),
        ...(query.length > 0 ? { query } : {}),
        ...(pathVariables.length > 0 ? { variable: pathVariables } : {}),
      },
    },
  };
}

function usesOnlyCookieAuth(operation: OperationObject): boolean {
  return Boolean(
    operation.security?.length
      && operation.security.every((requirement) => {
        const schemes = Object.keys(requirement);
        return schemes.length === 1 && schemes[0] === "console_session";
      }),
  );
}

function toPostmanHeader(parameter: ParameterObject): PostmanHeader {
  const value =
    parameter.name.toLowerCase() === "idempotency-key"
      ? "{{$guid}}"
      : parameter.name.toLowerCase() === "if-match"
        ? "{{etag}}"
        : `{{${parameter.name}}}`;
  return {
    key: parameter.name,
    value,
    description: parameter.description,
    type: "text",
  };
}

function requestBodyExample(
  document: OpenAPIObject,
  operation: OperationObject,
): unknown {
  const requestBody = operation.requestBody;
  if (!requestBody || isReference(requestBody)) return undefined;
  const mediaType =
    requestBody.content?.["application/json"]
    ?? requestBody.content?.["application/*+json"];
  if (!mediaType) return undefined;
  if (mediaType.example !== undefined) return mediaType.example;
  if (!mediaType.schema) return {};
  return sampleSchema(document, mediaType.schema, new Set());
}

function sampleSchema(
  document: OpenAPIObject,
  schema: SchemaObject | ReferenceObject,
  visited: Set<string>,
): unknown {
  if (isReference(schema)) {
    if (visited.has(schema.$ref)) return {};
    const resolved = resolveSchema(document, schema.$ref);
    if (!resolved) return {};
    const nextVisited = new Set(visited);
    nextVisited.add(schema.$ref);
    return sampleSchema(document, resolved, nextVisited);
  }
  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (schema.enum?.length) return schema.enum[0];
  if (schema.type === "array") {
    return schema.items ? [sampleSchema(document, schema.items, visited)] : [];
  }
  if (schema.type === "object" || schema.properties) {
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([key, value]) => [
        key,
        sampleSchema(document, value, visited),
      ]),
    );
  }
  if (schema.type === "boolean") return false;
  if (schema.type === "integer" || schema.type === "number") return 0;
  return "";
}

function resolveSchema(
  document: OpenAPIObject,
  reference: string,
): SchemaObject | ReferenceObject | undefined {
  const prefix = "#/components/schemas/";
  if (!reference.startsWith(prefix)) return undefined;
  return document.components?.schemas?.[reference.slice(prefix.length)];
}

function isReference(value: unknown): value is ReferenceObject {
  return Boolean(
    value
      && typeof value === "object"
      && "$ref" in value
      && typeof (value as { $ref?: unknown }).$ref === "string",
  );
}
