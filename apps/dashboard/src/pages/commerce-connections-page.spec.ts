/**
 * Commerce Connections Page — Unit Tests
 * TDD Phase 0: Tests written BEFORE implementation (RED → GREEN)
 */
import { describe, expect, it } from "vitest";
import { DashboardHttpError } from "../api-client.js";
import { sanitizeError } from "./commerce-connections-page.js";

// ── Task 0.2: sanitizeError unit tests ──────────────────────────────────────

describe("sanitizeError", () => {
  it("maps 401 to session expired message", () => {
    const err = new DashboardHttpError(401, "Unauthorized");
    expect(sanitizeError(err)).toBe("Sessão expirada. Faça login novamente.");
  });

  it("maps 403 to permission denied message", () => {
    const err = new DashboardHttpError(403, "Forbidden");
    expect(sanitizeError(err)).toBe("Sem permissão para esta ação.");
  });

  it("maps 409 to conflict message", () => {
    const err = new DashboardHttpError(409, "Conflict");
    expect(sanitizeError(err)).toBe("Já existe uma conexão ativa. Remova a atual primeiro.");
  });

  it("maps 422 to invalid credentials message", () => {
    const err = new DashboardHttpError(422, "Unprocessable Entity");
    expect(sanitizeError(err)).toBe("Credenciais inválidas. Verifique os dados e tente novamente.");
  });

  it("maps 500 to internal error message", () => {
    const err = new DashboardHttpError(500, "Internal Server Error");
    expect(sanitizeError(err)).toBe("Erro interno. Tente novamente em alguns minutos.");
  });

  it("maps 502 to internal error message", () => {
    const err = new DashboardHttpError(502, "Bad Gateway");
    expect(sanitizeError(err)).toBe("Erro interno. Tente novamente em alguns minutos.");
  });

  it("maps 503 to internal error message", () => {
    const err = new DashboardHttpError(503, "Service Unavailable");
    expect(sanitizeError(err)).toBe("Erro interno. Tente novamente em alguns minutos.");
  });

  it("maps TypeError (network error) to connectivity message", () => {
    const err = new TypeError("Failed to fetch");
    expect(sanitizeError(err)).toBe("Sem conexão com o servidor.");
  });

  it("maps generic Error to generic message, never exposing raw .message", () => {
    const err = new Error("Some internal stack trace: db connection pool exhausted");
    const result = sanitizeError(err);
    expect(result).toBe("Ocorreu um erro inesperado. Tente novamente.");
    expect(result).not.toContain("stack trace");
    expect(result).not.toContain("db connection");
  });

  it("maps unknown value to generic message", () => {
    expect(sanitizeError("random string")).toBe("Ocorreu um erro inesperado. Tente novamente.");
    expect(sanitizeError(null)).toBe("Ocorreu um erro inesperado. Tente novamente.");
    expect(sanitizeError(undefined)).toBe("Ocorreu um erro inesperado. Tente novamente.");
  });

  it("maps 400 to generic client error", () => {
    const err = new DashboardHttpError(400, "Bad Request with sensitive info");
    const result = sanitizeError(err);
    expect(result).not.toContain("sensitive");
  });
});

// ── Task 0.4: Validation pattern tests ──────────────────────────────────────

import {
  SHOPIFY_TOKEN_PATTERN,
  WOOCOMMERCE_KEY_PATTERN,
  WOOCOMMERCE_SECRET_PATTERN,
} from "./commerce-connections-page.js";

describe("validation patterns", () => {
  it("SHOPIFY_TOKEN_PATTERN matches valid shpat_ tokens", () => {
    expect(SHOPIFY_TOKEN_PATTERN.test("SHPAT_TEST_TOKEN_32_PLACEHOLDER_")).toBe(true);
    expect(SHOPIFY_TOKEN_PATTERN.test("SHPAT_TEST_TOKEN_40_CHARS_PLACEHOLDER_XX")).toBe(true);
  });

  it("SHOPIFY_TOKEN_PATTERN rejects invalid tokens", () => {
    expect(SHOPIFY_TOKEN_PATTERN.test("invalid_token")).toBe(false);
    expect(SHOPIFY_TOKEN_PATTERN.test("shpat_short")).toBe(false);
    expect(SHOPIFY_TOKEN_PATTERN.test("")).toBe(false);
  });

  it("WOOCOMMERCE_KEY_PATTERN matches valid ck_ keys", () => {
    expect(WOOCOMMERCE_KEY_PATTERN.test("ck_abcdef1234567890abcdef1234567890")).toBe(true);
  });

  it("WOOCOMMERCE_KEY_PATTERN rejects invalid keys", () => {
    expect(WOOCOMMERCE_KEY_PATTERN.test("invalid_key")).toBe(false);
    expect(WOOCOMMERCE_KEY_PATTERN.test("ck_short")).toBe(false);
    expect(WOOCOMMERCE_KEY_PATTERN.test("")).toBe(false);
  });

  it("WOOCOMMERCE_SECRET_PATTERN matches valid cs_ secrets", () => {
    expect(WOOCOMMERCE_SECRET_PATTERN.test("cs_abcdef1234567890abcdef1234567890")).toBe(true);
  });

  it("WOOCOMMERCE_SECRET_PATTERN rejects invalid secrets", () => {
    expect(WOOCOMMERCE_SECRET_PATTERN.test("invalid_secret")).toBe(false);
    expect(WOOCOMMERCE_SECRET_PATTERN.test("cs_short")).toBe(false);
    expect(WOOCOMMERCE_SECRET_PATTERN.test("")).toBe(false);
  });
});
