import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { expect, it } from "vitest";

it("emits the existing green favicon as a fingerprinted PNG, not an SPA HTML fallback", async () => {
  const result = await build({
    root: fileURLToPath(new URL("../../", import.meta.url)),
    configFile: false,
    publicDir: false,
    logLevel: "silent",
    plugins: [{ name: "favicon-only-probe", transformIndexHtml: {
      order: "pre", handler: html => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ""),
    } }],
    build: { write: false, assetsInlineLimit: 0, minify: false },
  });
  if (Array.isArray(result) || !("output" in result)) throw Error("Expected a single in-memory HTML build");
  const html = result.output.find(item => item.type === "asset" && item.fileName === "index.html");
  if (!html || html.type !== "asset") throw Error("Missing emitted HTML");
  const href = String(html.source).match(/rel="icon"[^>]*href="([^"]+)"/)?.[1];
  expect(href).toMatch(/^\/assets\/zyon-favicon-green-[\w-]+\.png$/);
  const icon = result.output.find(item => item.type === "asset" && `/${item.fileName}` === href);
  if (!icon || icon.type !== "asset") throw Error("HTML icon must reference an emitted asset");
  const payload = Buffer.from(icon.source);
  expect(payload.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  const existing = readFileSync(new URL("../../public/zyon-favicon-green.png", import.meta.url));
  const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  expect(hash(payload)).toBe(hash(existing));
});

