import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const dashboardRoot = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.argv[2] ?? resolve(dashboardRoot, "test-results/order-customer-money"));
const moduleId = "virtual:qa-order-customer-money.jsx";
// Actual page components; only read API responses are fixture-backed.
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ApiContext } from '/src/hooks/useApi.ts';
import { OrdersShipmentsPage } from '/src/pages/orders-shipments-page.tsx';
import { CustomersPage } from '/src/pages/customers-page.tsx';
import '/src/styles.css';
const now = new Date().toISOString();
const me = { id: 'qa-merchant', name: 'Loja QA' };
const customer = { id: 'buyer', profile: { full_name: 'Cliente QA', email: 'qa@example.invalid' }, first_seen_at: now, last_seen_at: now };
const order = { id: 'order', session_id: 'session', external_order_id: 'QA-10', status: 'approved', total: 2000, currency: 'BRL',
  completed_at: now, customer: customer.profile, cart: { items: [
    { name: 'Item em reais', price: 10, quantity: 1 },
    { name: 'Item em centavos', unitPriceCents: 1000, quantity: 1 },
    { name: 'Item gratuito', price: 0, quantity: 1 },
    { name: 'Preço ausente', quantity: 1 }
  ] } };
let historyCase = 'legacy';
const histories = {
  legacy: [{ order_id: 'legacy', total: 1000, currency: 'BRL', completed_at: now }],
  canonical: [{ order_id: 'canonical', total_minor: 1000, currency: 'BRL', completed_at: now }],
  malformed: [{ order_id: 'missing', currency: 'BRL', completed_at: now }],
  missing: undefined,
  empty: [],
  mixed: [{ order_id: 'br', total_minor: 1000, currency: 'BRL', completed_at: now }, { order_id: 'us', total_minor: 1500, currency: 'USD', completed_at: now }]
};
const api = {
  getOrders: async () => ({ data: [order], next_cursor: null, has_more: false }),
  getOrderDetail: async () => ({ ...order, timeline: [] }),
  getDigitalOrderAccess: async () => ({ products: [] }),
  getDeliveryConfig: async () => ({ shippingEnabled: false }),
  getCustomersPage: async () => ({ data: [customer], next_cursor: null, has_more: false }),
  getCustomerMetrics: async () => ({ total_customers: 1, new_customers: 1, repeat_rate: 0 }),
  getCustomerDetail: async () => ({ ...customer, purchase_history: histories[historyCase] })
};
function App() {
  const [page, setPage] = React.useState('orders');
  window.qaShowPage = name => setPage(name);
  return React.createElement(page === 'orders' ? OrdersShipmentsPage : CustomersPage, { apiBaseUrl: '', me });
}
window.qaHistoryCase = name => { historyCase = name; };
createRoot(document.getElementById('root')).render(React.createElement(ApiContext.Provider, { value: api }, React.createElement(App)));
`;
const server = await createServer({ root: dashboardRoot, configFile: false, plugins: [react(), {
  name: "qa-order-customer-money",
  resolveId(id) { if (id === moduleId) return `\0${moduleId}`; },
  load(id) { if (id === `\0${moduleId}`) return fixture; },
  configureServer(dev) {
    dev.middlewares.use(async (req, res, next) => {
      if (req.url !== "/qa-money") return next();
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(await dev.transformIndexHtml("/qa-money", `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/${moduleId}"></script></body></html>`));
    });
  },
}], server: { host: "127.0.0.1", port: 0, fs: { allow: [resolve(dashboardRoot, "../..")] } } });
let browser;
try {
  await mkdir(output, { recursive: true });
  await server.listen();
  const address = server.httpServer.address();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  const capture = async fileName => {
    await page.locator(".ui-dialog").evaluate(async element => {
      await Promise.all(element.getAnimations().map(animation => animation.finished));
    });
    await page.screenshot({ path: resolve(output, fileName), fullPage: true });
  };
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" && url.port === String(address.port) ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${address.port}/qa-money`);
  await page.getByRole("button", { name: /Ver pedido QA-10/ }).click();
  const orderDialog = page.getByRole("dialog", { name: "Pedido QA-10" });
  await expect(orderDialog).toBeVisible();
  await expect(orderDialog.getByText("Item em reais").locator("..")).toContainText("10,00");
  await expect(orderDialog.getByText("Item em centavos").locator("..")).toContainText("10,00");
  await expect(orderDialog.getByText("Item gratuito").locator("..")).toContainText("0,00");
  await expect(orderDialog.getByText("Preço ausente").locator("..")).toContainText("Valor indisponível");
  expect(await orderDialog.innerText()).not.toContain("0,10");
  await capture("order-money-desktop.png");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await capture("order-money-mobile.png");
  await orderDialog.getByRole("contentinfo").getByRole("button", { name: "Fechar", exact: true }).click();
  await page.evaluate(() => window.qaShowPage("customers"));
  const openCustomer = async name => {
    await page.evaluate(name => window.qaHistoryCase(name), name);
    await page.getByRole("button", { name: "Cliente QA", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Cliente QA" });
    await expect(dialog).toBeVisible();
    return dialog;
  };
  for (const name of ["legacy", "canonical"]) {
    const dialog = await openCustomer(name);
    await expect(dialog.getByText("Receita no histórico").locator("..")).toContainText("10,00");
    await expect(dialog.getByText("Ticket médio").locator("..")).toContainText("10,00");
    expect(await dialog.innerText()).not.toContain("NaN");
    if (name === "legacy") await capture("customer-money-mobile.png");
    await dialog.getByRole("contentinfo").getByRole("button", { name: "Fechar", exact: true }).click();
  }
  const malformed = await openCustomer("malformed");
  await expect(malformed.getByText("Receita no histórico").locator("..")).toContainText("Indisponível");
  await expect(malformed.getByText("Valor indisponível")).toBeVisible();
  expect(await malformed.innerText()).not.toContain("NaN");
  await malformed.getByRole("contentinfo").getByRole("button", { name: "Fechar", exact: true }).click();
  const missing = await openCustomer("missing");
  await expect(missing.getByText("Histórico indisponível")).toBeVisible();
  await expect(missing.getByText("Nenhum pedido registrado")).toHaveCount(0);
  await missing.getByRole("contentinfo").getByRole("button", { name: "Fechar", exact: true }).click();
  const empty = await openCustomer("empty");
  await expect(empty.getByText("Nenhum pedido registrado")).toBeVisible();
  await empty.getByRole("contentinfo").getByRole("button", { name: "Fechar", exact: true }).click();
  const mixed = await openCustomer("mixed");
  await expect(mixed.getByText("Receita no histórico").locator("..")).toContainText("Indisponível");
  await expect(mixed.getByText(/moeda diferente de real/)).toBeVisible();
  await page.setViewportSize({ width: 1200, height: 1000 });
  await capture("customer-money-desktop.png");
  expect(errors).toEqual([]);
  const result = { status: "passed", assertions: ["major/minor unit prices", "zero unit price", "unknown unit price", "legacy/canonical customer amounts", "no NaN", "missing versus empty history", "currency separation", "mobile overflow"], api: "fixtures", network: "loopback only", browser: "Chromium" };
  await writeFile(resolve(output, "result.json"), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result) + "\n");
} finally { await browser?.close(); await server.close(); }
