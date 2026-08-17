import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { formatExpiry, validateEmbedForm, copyToClipboard } from "./useEmbedPage.js";

// ── formatExpiry ─────────────────────────────────────────────────────────────

describe("formatExpiry", () => {
  it("returns formatted date with (expirado) when timestamp is in the past", () => {
    const pastUnix = Math.floor(Date.now() / 1000) - 3600;
    const result = formatExpiry(pastUnix);
    expect(result).toContain("(expirado)");
    expect(result).toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it("returns relative minutes when under 60 min in the future", () => {
    const futureUnix = Math.floor(Date.now() / 1000) + 15 * 60;
    const result = formatExpiry(futureUnix);
    expect(result).toMatch(/\(expira em \d+ min\)/);
  });

  it("returns relative hours when 60+ min in the future", () => {
    const futureUnix = Math.floor(Date.now() / 1000) + 3 * 3600;
    const result = formatExpiry(futureUnix);
    expect(result).toMatch(/\(expira em \d+h\)/);
  });

  it("formats date in pt-BR locale (dd/mm/yyyy)", () => {
    const unix = Math.floor(new Date("2026-03-15T14:30:00Z").getTime() / 1000);
    const result = formatExpiry(unix);
    expect(result).toMatch(/15\/03\/2026/);
  });
});

// ── validateEmbedForm ────────────────────────────────────────────────────────

describe("validateEmbedForm", () => {
  const validParams = {
    allowedOrigin: "https://minha-loja.com",
    cartRef: "cart_abc",
    ttl: 900,
    scopes: ["checkout:start"],
  };

  it("returns empty object for valid input", () => {
    expect(validateEmbedForm(validParams)).toEqual({});
  });

  it("rejects invalid URL", () => {
    const result = validateEmbedForm({ ...validParams, allowedOrigin: "not-a-url" });
    expect(result.allowedOrigin).toBe("URL inválida. Ex: https://minha-loja.com");
  });

  it("rejects non-http/https protocol", () => {
    const result = validateEmbedForm({ ...validParams, allowedOrigin: "ftp://example.com" });
    expect(result.allowedOrigin).toBe("Protocolo deve ser http ou https");
  });

  it("accepts http:// URLs", () => {
    const result = validateEmbedForm({ ...validParams, allowedOrigin: "http://localhost:3000" });
    expect(result.allowedOrigin).toBeUndefined();
  });

  it("rejects empty cartRef", () => {
    const result = validateEmbedForm({ ...validParams, cartRef: "" });
    expect(result.cartRef).toBe("Referência do carrinho é obrigatória");
  });

  it("rejects whitespace-only cartRef", () => {
    const result = validateEmbedForm({ ...validParams, cartRef: "   " });
    expect(result.cartRef).toBe("Referência do carrinho é obrigatória");
  });

  it("rejects TTL below 60", () => {
    const result = validateEmbedForm({ ...validParams, ttl: 30 });
    expect(result.ttl).toBe("TTL deve estar entre 60 e 86400 segundos");
  });

  it("rejects TTL above 86400", () => {
    const result = validateEmbedForm({ ...validParams, ttl: 100000 });
    expect(result.ttl).toBe("TTL deve estar entre 60 e 86400 segundos");
  });

  it("accepts TTL at boundary 60", () => {
    const result = validateEmbedForm({ ...validParams, ttl: 60 });
    expect(result.ttl).toBeUndefined();
  });

  it("accepts TTL at boundary 86400", () => {
    const result = validateEmbedForm({ ...validParams, ttl: 86400 });
    expect(result.ttl).toBeUndefined();
  });

  it("rejects empty scopes array", () => {
    const result = validateEmbedForm({ ...validParams, scopes: [] });
    expect(result.scopes).toBe("Selecione ao menos um escopo");
  });

  it("can return multiple errors at once", () => {
    const result = validateEmbedForm({
      allowedOrigin: "bad",
      cartRef: "",
      ttl: 10,
      scopes: [],
    });
    expect(Object.keys(result)).toHaveLength(4);
  });
});

// ── copyToClipboard ──────────────────────────────────────────────────────────

describe("copyToClipboard", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("uses navigator.clipboard.writeText when available", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
    const result = await copyToClipboard("test");
    expect(result).toBe(true);
    expect(writeText).toHaveBeenCalledWith("test");
  });

  it("falls back to execCommand when clipboard API throws", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
      writable: true,
      configurable: true,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    const mockTextarea = { value: "", style: {} as Record<string, string>, select: vi.fn() };
    const mockDoc = {
      createElement: vi.fn().mockReturnValue(mockTextarea),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand,
    };
    vi.stubGlobal("document", mockDoc);
    const result = await copyToClipboard("fallback-text");
    expect(result).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(mockDoc.createElement).toHaveBeenCalledWith("textarea");
    vi.unstubAllGlobals();
  });

  it("falls back to execCommand when clipboard is undefined", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });
    const execCommand = vi.fn().mockReturnValue(true);
    const mockTextarea = { value: "", style: {} as Record<string, string>, select: vi.fn() };
    const mockDoc = {
      createElement: vi.fn().mockReturnValue(mockTextarea),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
      execCommand,
    };
    vi.stubGlobal("document", mockDoc);
    const result = await copyToClipboard("no-clipboard");
    expect(result).toBe(true);
    expect(execCommand).toHaveBeenCalledWith("copy");
    vi.unstubAllGlobals();
  });
});
