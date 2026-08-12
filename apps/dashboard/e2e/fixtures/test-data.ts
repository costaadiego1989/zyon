/**
 * Test data constants and factories for E2E.
 * Contains stable identifiers and builders for test scenarios.
 */

import { E2E_RUN_ID } from "../config";

/* ── Run-scoped identifiers ─────────────────────────────────────── */

/** Current E2E run ID — use for identifying/cleaning transient data */
export { E2E_RUN_ID };

/* ── Test users ─────────────────────────────────────────────────── */

export const DEMO_MERCHANT = {
  email: "demo@zyon.com",
  password: "demo1234",
  name: "Zyon Demo Store",
} as const;

export const INVALID_CREDENTIALS = {
  wrongEmail: "nonexistent@fake.com",
  wrongPassword: "wrongpassword123",
  malformedEmail: "not-an-email",
  shortPassword: "ab",
} as const;

/* ── Navigation routes ──────────────────────────────────────────── */

export const ROUTES = {
  login: "/",
  overview: "/",
  orders: "/",
  customers: "/",
  integrations: "/",
  checkoutSettings: "/",
  theme: "/",
  embed: "/",
  billing: "/",
  payments: "/",
  audit: "/",
  support: "/",
  negotiation: "/",
  commerce: "/",
  preview: "/",
} as const;

/* ── Navigation labels (PT-BR) ──────────────────────────────────── */

export const NAV_LABELS = {
  overview: "Operação",
  orders: "Pedidos",
  customers: "Clientes",
  integrations: "Integrações",
  checkoutSettings: "Checkout",
  theme: "Aparência",
  embed: "Embed",
  billing: "Planos",
  payments: "Pagamentos",
  audit: "Logs",
  support: "Suporte",
  negotiation: "Negociação",
  commerce: "Comércio",
  preview: "Preview",
} as const;

/* ── Test data factories ────────────────────────────────────────── */

/**
 * Generate a unique test email scoped to this run.
 */
export function testEmail(prefix = "e2e"): string {
  return `${prefix}+${E2E_RUN_ID}@test.zyon.com`;
}

/**
 * Generate a unique merchant name scoped to this run.
 */
export function testMerchantName(suffix = ""): string {
  return `E2E Store ${E2E_RUN_ID}${suffix ? ` ${suffix}` : ""}`;
}
