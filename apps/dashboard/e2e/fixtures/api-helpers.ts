/**
 * API helpers for E2E test setup and teardown.
 * Directly calls the API to seed/clean data without going through the UI.
 */

import type { APIRequestContext } from "@playwright/test";
import { API_BASE_URL, TEST_EMAIL, TEST_PASSWORD, E2E_RUN_ID } from "../config";

/* ── Auth helpers ───────────────────────────────────────────────── */

export interface AuthTokens {
  accessToken: string;
  merchantId: string;
}

/**
 * Login via API and return tokens.
 */
export async function apiLogin(
  request: APIRequestContext,
  email = TEST_EMAIL,
  password = TEST_PASSWORD,
): Promise<AuthTokens | null> {
  const res = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { email, password },
  });
  if (!res.ok()) return null;
  const body = await res.json();
  return {
    accessToken: body.access_token ?? body.accessToken ?? body.token,
    merchantId: body.merchant_id ?? body.merchantId,
  };
}

/**
 * Get authenticated request headers.
 */
export function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

/* ── Seed helpers ───────────────────────────────────────────────── */

export interface SeedResult {
  merchantId: string;
  embedToken?: string;
  productId?: string;
}

/**
 * Seed test data via API (if endpoint exists).
 */
export async function seedTestData(
  request: APIRequestContext,
): Promise<SeedResult | null> {
  try {
    const res = await request.post(`${API_BASE_URL}/__test__/seed`);
    if (!res.ok()) return null;
    return (await res.json()) as SeedResult;
  } catch {
    return null;
  }
}

/* ── Cleanup helpers ────────────────────────────────────────────── */

/**
 * Clean up test data created during this run.
 * Uses E2E_RUN_ID to identify ephemeral records.
 */
export async function cleanupTestData(
  request: APIRequestContext,
  tokens: AuthTokens,
): Promise<void> {
  try {
    await request.post(`${API_BASE_URL}/__test__/cleanup`, {
      headers: authHeaders(tokens.accessToken),
      data: { runId: E2E_RUN_ID },
    });
  } catch {
    // Cleanup is best-effort — don't fail tests if cleanup endpoint missing
  }
}

/* ── Health check ───────────────────────────────────────────────── */

/**
 * Check if the API is reachable before running tests.
 */
export async function waitForApi(
  request: APIRequestContext,
  timeoutMs = 30_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await request.get(`${API_BASE_URL}/health`);
      if (res.ok()) return true;
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  return false;
}
