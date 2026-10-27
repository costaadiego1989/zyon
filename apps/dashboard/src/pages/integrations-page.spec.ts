/**
 * Integrations Page Redesign — Unit Tests
 * TDD Phase: Tests written BEFORE implementation (RED → GREEN)
 */
import { describe, expect, it } from "vitest";
import { relativeTime } from "./integrations-page.js";
import { readError } from "../utils/read-error.js";
import { DashboardHttpError } from "../api-client.js";

// ── Phase 1: Portuguese Accent Verification ────────────────────────────────

describe("Portuguese accent compliance", () => {
  it("relativeTime returns PT-BR relative strings with correct accents", () => {
    const now = Date.now();
    expect(relativeTime(new Date(now - 30000).toISOString())).toBe("agora");
    expect(relativeTime(new Date(now - 5 * 60000).toISOString())).toBe("há 5 min");
    expect(relativeTime(new Date(now - 3600000).toISOString())).toBe("há 1h");
    expect(relativeTime(new Date(now - 48 * 3600000).toISOString())).toBe("há 2d");
  });
});

// ── Phase 7: relativeTime utility ──────────────────────────────────────────

describe("relativeTime", () => {
  it('returns "agora" for less than 1 minute ago', () => {
    const now = new Date().toISOString();
    expect(relativeTime(now)).toBe("agora");
  });

  it('returns "há N min" for minutes', () => {
    const iso = new Date(Date.now() - 10 * 60000).toISOString();
    expect(relativeTime(iso)).toBe("há 10 min");
  });

  it('returns "há Nh" for hours', () => {
    const iso = new Date(Date.now() - 5 * 3600000).toISOString();
    expect(relativeTime(iso)).toBe("há 5h");
  });

  it('returns "há Nd" for days less than 30', () => {
    const iso = new Date(Date.now() - 7 * 86400000).toISOString();
    expect(relativeTime(iso)).toBe("há 7d");
  });

  it("returns formatted date for 30+ days", () => {
    const old = new Date(Date.now() - 45 * 86400000).toISOString();
    const result = relativeTime(old);
    // Should be a pt-BR formatted date like "18/05/2026"
    expect(result).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
  });
});

// ── readError utility ──────────────────────────────────────────────────────

describe("readError", () => {
  it("extracts DashboardHttpError body truncated to 180 chars", () => {
    const longBody = "x".repeat(300);
    const err = new DashboardHttpError(500, longBody);
    expect(readError(err)).toHaveLength(180);
  });

  it("extracts Error message", () => {
    const err = new Error("connection refused");
    expect(readError(err)).toBe("connection refused");
  });

  it("converts unknown values to string", () => {
    expect(readError(42)).toBe("42");
    expect(readError(null)).toBe("null");
  });
});
