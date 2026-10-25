import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { useCountdown, useAutoRenewal, DEVICE_SIZES } from "./preview-page.js";

// ── T4.1: useCountdown hook ──────────────────────────────────────────────────

describe("useCountdown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when expiresAtUnix is null", () => {
    const result = useCountdown(null);
    expect(result).toBe(null);
  });

  it("returns '14:59' when 899 seconds remain", () => {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 899;
    const result = useCountdown(expiresAt);
    expect(result).toBe("14:59");
  });

  it("returns '0:00' when expired", () => {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now - 10;
    const result = useCountdown(expiresAt);
    expect(result).toBe("0:00");
  });

  it("decrements each second", () => {
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 120;
    const result1 = useCountdown(expiresAt);
    expect(result1).toBe("2:00");

    vi.advanceTimersByTime(1000);
    const result2 = useCountdown(expiresAt);
    expect(result2).toBe("1:59");
  });
});

// ── T4.2: Auto-renewal logic ─────────────────────────────────────────────────

describe("useAutoRenewal", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules reload at T-60s before expiry", () => {
    const reload = vi.fn();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 300; // 5 minutes from now

    useAutoRenewal(expiresAt, reload);

    expect(reload).not.toHaveBeenCalled();

    // Advance to T-60s (240 seconds)
    vi.advanceTimersByTime(240_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("calls reload immediately if already past T-60s", () => {
    const reload = vi.fn();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = now + 30; // only 30s left, already past T-60s

    useAutoRenewal(expiresAt, reload);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("clears previous timer when expiresAtUnix changes", () => {
    const reload = vi.fn();
    const now = Math.floor(Date.now() / 1000);
    const expiresAt1 = now + 300;

    const cleanup1 = useAutoRenewal(expiresAt1, reload);
    cleanup1();

    const expiresAt2 = now + 600;
    useAutoRenewal(expiresAt2, reload);

    // Advance past first timer but not second
    vi.advanceTimersByTime(240_000);
    expect(reload).not.toHaveBeenCalled();

    // Advance to second timer (540s = 600 - 60)
    vi.advanceTimersByTime(300_000);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

// ── T4.3: DEVICE_SIZES constant ──────────────────────────────────────────────

describe("DEVICE_SIZES", () => {
  it("defines desktop, tablet, and mobile widths", () => {
    expect(DEVICE_SIZES.desktop.width).toBe("100%");
    expect(DEVICE_SIZES.tablet.width).toBe("768px");
    expect(DEVICE_SIZES.mobile.width).toBe("375px");
  });

  it("has labels for all device sizes", () => {
    expect(DEVICE_SIZES.desktop.label).toBe("Desktop");
    expect(DEVICE_SIZES.tablet.label).toBe("Tablet");
    expect(DEVICE_SIZES.mobile.label).toBe("Mobile");
  });
});
