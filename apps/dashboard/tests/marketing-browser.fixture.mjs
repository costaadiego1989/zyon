import { createRequire } from "node:module";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
const directory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(directory, "../package.json"));
const viteRequire = createRequire(require.resolve("vite"));
const { build } = viteRequire("esbuild");
export const { chromium, expect } = require("@playwright/test");

/** Bundles the actual React screens and existing HTTP client; all API calls reach Nest/PostgreSQL. */
export async function marketingBrowserFixture(api, options = {}) {
  const result = await build({
    entryPoints: [
      path.join(directory, options.entry ?? "marketing-browser-entry.tsx"),
    ],
    bundle: true,
    write: false,
    outfile: path.join(directory, ".local/marketing.js"),
    format: "iife",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    define: {
      "import.meta.env": JSON.stringify({
        VITE_API_BASE_URL: api.base.replace(/\/marketing$/, ""),
      }),
      "process.env.NODE_ENV": '"test"',
      "process.env.NEXT_PUBLIC_API_BASE_URL": JSON.stringify(
        api.base.replace(/\/marketing$/, "")
      ),
    },
    loader: {
      ".woff2": "file",
      ".woff": "file",
      ".ttf": "file",
      ".svg": "file",
      ".png": "file",
    },
    logLevel: "silent",
  });
  const files = new Map(
    result.outputFiles.map((file) => [path.basename(file.path), file.contents])
  );
  const server = createServer((request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const filename = path.basename(url.pathname);
    if (files.has(filename)) {
      response.setHeader(
        "Content-Type",
        filename.endsWith(".js")
          ? "text/javascript"
          : filename.endsWith(".css")
          ? "text/css"
          : "application/octet-stream"
      );
      response.end(files.get(filename));
      return;
    }
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(
      '<!doctype html><html lang="pt-BR"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/marketing.css"><body><div id="root"></div><script src="/marketing.js"></script></body></html>'
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/?api=${encodeURIComponent(
    api.base.replace(/\/marketing$/, "")
  )}`;
  const fullUrl = `${url}&merchant=${encodeURIComponent(api.merchantId)}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  await page.context().addCookies([
    {
      name: "aacp_access_token",
      value: api.users[options.role ?? "owner"].token,
      url: new URL(api.base).origin,
      sameSite: "Lax",
    },
  ]);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  return {
    page,
    url: fullUrl,
    errors,
    close: async () => {
      await browser.close();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
