/**
 * Dashboard E2E shared configuration.
 * All constants, URLs, and environment-derived config live here.
 */

export const CI = !!process.env.CI;

/** Dashboard base URL — override via PLAYWRIGHT_BASE_URL env */
export const DASHBOARD_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5175";

/** API base URL — dashboard talks to this for auth + data */
export const API_BASE_URL = process.env.E2E_API_URL ?? "http://127.0.0.1:3009";

/** Test credentials — NEVER hardcode real passwords in source */
export const TEST_EMAIL = process.env.E2E_TEST_EMAIL ?? "demo@zyon.com";
export const TEST_PASSWORD = process.env.E2E_TEST_PASSWORD ?? "demo1234";

/** Unique identifier per test run — useful for cleanup/isolation */
export const E2E_RUN_ID = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** Storage state path for authenticated sessions */
export const STORAGE_STATE_PATH = "e2e/.auth/storage-state.json";

/** Timeouts */
export const TIMEOUTS = {
  /** Page navigation */
  navigation: 15_000,
  /** Element visibility after action */
  element: 10_000,
  /** API response */
  api: 10_000,
  /** Auth flow (login redirect) */
  auth: 15_000,
  /** Long operations (reports, exports) */
  long: 30_000,
} as const;

/** Mobile viewport */
export const MOBILE_VIEWPORT = { width: 375, height: 667 };

/** Tablet viewport */
export const TABLET_VIEWPORT = { width: 768, height: 1024 };
