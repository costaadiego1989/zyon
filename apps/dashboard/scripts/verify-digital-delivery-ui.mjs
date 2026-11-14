import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Component browser smoke. All API methods are fixtures; outbound network is
// blocked. The API/database contract is covered separately by integration tests.
const dashboardRoot = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.argv[2] ?? resolve(dashboardRoot, "test-results/digital-delivery-ui"));
const moduleId = "virtual:qa-digital-delivery.jsx";
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ApiContext } from '/src/hooks/useApi.ts';
import { DigitalOrderDelivery } from '/src/pages/orders-shipments/components/DigitalOrderDelivery.tsx';
import '/src/styles.css';
import '/src/pages/orders-shipments/orders-shipments.css';
let mode = 'normal', version = 0, retries = 0;
const products = [
  { id: 'grant-a', name: 'Livro digital', status: 'active', downloadCount: 2, expiresAt: '2026-12-01T12:00:00.000Z', deliveries: [
    { id: 'delivery-email', channel: 'email', status: 'blocked', reason: 'email_not_configured' },
    { id: 'delivery-whatsapp', channel: 'whatsapp', status: 'uncertain', reason: 'provider_acceptance_unknown' }
  ] },
  { id: 'grant-b', name: 'Curso expirado', status: 'expired', downloadCount: 0, expiresAt: '2026-09-01T12:00:00.000Z', deliveries: [
    { id: 'delivery-expired', channel: 'email', status: 'blocked', reason: 'digital_access_unavailable' }
  ] },
  { id: 'grant-c', name: 'Guia enviado', status: 'active', downloadCount: 1, expiresAt: '2026-12-01T12:00:00.000Z', deliveries: [
    { id: 'delivery-sent', channel: 'email', status: 'sent', reason: null }
  ] }
];
const api = {
  getDigitalOrderAccess: async (merchant, order) => {
    if (merchant !== 'qa-merchant' || order !== 'qa-order') throw Error('invalid_scope');
    if (mode === 'error') throw Error('provider_private_diagnostics');
    return { products: mode === 'empty' ? [] : structuredClone(products) };
  },
  retryDigitalDelivery: async (merchant, id) => {
    if (merchant !== 'qa-merchant' || id !== 'delivery-email') throw Error('invalid_retry');
    retries++; products[0].deliveries[0].status = 'pending'; return { status: 'queued' };
  }
};
const root = createRoot(document.getElementById('root'));
function render() { root.render(React.createElement(ApiContext.Provider, { value: api }, React.createElement('main', { style: { maxWidth: 460, margin: '24px auto', padding: '0 20px', color: 'var(--color-text)' } }, React.createElement(DigitalOrderDelivery, { key: version, merchantId: 'qa-merchant', orderId: 'qa-order' })))); }
window.qaSetMode = value => { mode = value; version++; render(); };
window.qaRetries = () => retries;
render();
`;
const server = await createServer({
  root: dashboardRoot, configFile: false, plugins: [react(), {
    name: "qa-digital-delivery",
    resolveId(id) { if (id === moduleId) return `\0${moduleId}`; },
    load(id) { if (id === `\0${moduleId}`) return fixture; },
    configureServer(dev) {
      dev.middlewares.use(async (req, res, next) => {
        if (req.url !== "/qa-digital") return next();
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(await dev.transformIndexHtml("/qa-digital", `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/${moduleId}"></script></body></html>`));
      });
    },
  }], server: { host: "127.0.0.1", port: 0, fs: { allow: [resolve(dashboardRoot, "../..")] } },
});
let browser;
try {
  await mkdir(output, { recursive: true });
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 1100 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" && url.port === String(address.port) ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${address.port}/qa-digital`);
  await expect(page.getByText("WhatsApp: Confirmação pendente")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tentar envio novamente" })).toHaveCount(1);
  await expect(page.getByText("Email: Aceito pelo provedor")).toBeVisible();
  await expect(page.getByText("O aceite do provedor não confirma", { exact: false })).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/downloadUrl|https:\/\/|email_not_configured|provider_acceptance_unknown/);
  await page.screenshot({ path: resolve(output, "digital-delivery-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(output, "digital-delivery-mobile.png"), fullPage: true });
  await page.getByRole("button", { name: "Tentar envio novamente" }).click();
  await expect(page.getByText("Email: Aguardando envio")).toBeVisible();
  await expect(page.getByRole("button", { name: "Tentar envio novamente" })).toHaveCount(0);
  expect(await page.evaluate(() => window.qaRetries())).toBe(1);
  await page.evaluate(() => window.qaSetMode("empty"));
  await expect(page.getByRole("region", { name: "Entrega digital" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Entrega digital" })).toHaveCount(0);
  await page.evaluate(() => window.qaSetMode("error"));
  await expect(page.getByRole("alert")).toHaveText("Não foi possível consultar a entrega digital deste pedido.");
  expect(await page.locator("body").innerText()).not.toContain("provider_private_diagnostics");
  await page.evaluate(() => window.qaSetMode("normal"));
  await expect(page.getByText("Email: Aguardando envio")).toBeVisible();
  expect(errors).toEqual([]);
  const result = { status: "passed", assertions: ["provider states", "retry restrictions", "expired access", "empty order", "error recovery", "mobile overflow"], api: "fixtures", network: "loopback only", browser: "Chromium" };
  await writeFile(resolve(output, "result.json"), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result) + "\n");
} finally {
  await browser?.close();
  await server.close();
}
