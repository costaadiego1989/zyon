import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

// Actual React components with API fixtures. Redis/PostgreSQL are verified by
// spreadsheet-import.integration.spec.ts, independently of this UI smoke.
const dashboardRoot = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.argv[2] ?? resolve(dashboardRoot, "test-results/spreadsheet-import-ui"));
const moduleId = "virtual:qa-spreadsheet-import.jsx";
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ApiContext } from '/src/hooks/useApi.ts';
import { DashboardHttpError } from '/src/api/http/error.ts';
import { AiSpreadsheetImportModal } from '/src/components/spreadsheet-import/AiSpreadsheetImportModal.tsx';
import { ImportProgressProvider, useImportProgress } from '/src/components/spreadsheet-import/ImportProgressProvider.tsx';
import { ImportProgressBanner } from '/src/components/spreadsheet-import/ImportProgressBanner.tsx';
import '/src/styles.css';
let outage = true, lastMime, confirmed = false;
const job = { id: 'qa-job', status: 'completed', fileName: 'produtos.csv', totalRows: 5, successRows: 4, failedRows: 1,
  errors: [{ row: 5, sku: 'BAD', reason: 'invalid_stock_quantity' }],
  erpSummary: { queued: 1, running: 0, completed: 0, blocked: 1, uncertain: 0, failed: 0, superseded: 0 }
};
const api = { uploadSpreadsheetImport: async (merchant, file) => {
  if (merchant !== 'qa-merchant') throw Error('invalid scope');
  lastMime = file.mimeType;
  if (outage) throw new DashboardHttpError(503, JSON.stringify({ detail: 'import_queue_unavailable' }));
  return { jobId: 'qa-job', status: 'queued' };
} };
const getImportJob = async () => { const value = structuredClone(job); if (confirmed) { value.erpSummary.queued = 0; value.erpSummary.completed = 1; } return value; };
function App() {
  const [open, setOpen] = React.useState(true);
  const progress = useImportProgress();
  return React.createElement(React.Fragment, null,
    React.createElement(AiSpreadsheetImportModal, { isOpen: open, onClose: () => setOpen(false), merchantId: 'qa-merchant',
      onImportStarted: (id, name) => progress.startImport(id, name, 'qa-merchant') }),
    React.createElement(ImportProgressBanner));
}
window.qaAllowUpload = () => { outage = false; };
window.qaMime = () => lastMime;
window.qaConfirmErp = () => { confirmed = true; };
createRoot(document.getElementById('root')).render(React.createElement(ApiContext.Provider, { value: api },
  React.createElement(ImportProgressProvider, { getImportJob }, React.createElement(App))));
`;
const server = await createServer({
  root: dashboardRoot, configFile: false, plugins: [react(), {
    name: "qa-spreadsheet-import",
    resolveId(id) { if (id === moduleId) return `\0${moduleId}`; },
    load(id) { if (id === `\0${moduleId}`) return fixture; },
    configureServer(dev) {
      dev.middlewares.use(async (req, res, next) => {
        if (req.url !== "/qa-import") return next();
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(await dev.transformIndexHtml("/qa-import", `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/${moduleId}"></script></body></html>`));
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
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" && url.port === String(address.port) ? route.continue() : route.abort();
  });
  await page.goto(`http://127.0.0.1:${address.port}/qa-import`);
  await expect(page.getByRole("dialog", { name: "Importar planilha com IA" })).toBeVisible();
  const input = page.getByLabel("Selecionar planilha");
  await input.setInputFiles({ name: "antigo.xls", mimeType: "application/vnd.ms-excel", buffer: Buffer.from("fixture") });
  await expect(page.getByRole("alert")).toContainText("Formato não suportado");
  await input.setInputFiles({ name: "vazio.csv", mimeType: "text/csv", buffer: Buffer.alloc(0) });
  await expect(page.getByRole("alert")).toContainText("O arquivo está vazio");
  await input.setInputFiles({ name: "produtos.csv", mimeType: "application/octet-stream", buffer: Buffer.from("Nome,SKU,Preço\nEbook,DIGITAL,10") });
  await page.getByRole("button", { name: "Enviar e processar" }).click();
  await expect(page.getByRole("alert")).toContainText("processamento de planilhas está indisponível");
  expect(await page.evaluate(() => window.qaMime())).toBe("text/csv");
  expect(await page.locator("body").innerText()).not.toContain("import_queue_unavailable");
  await page.screenshot({ path: resolve(output, "import-upload-outage-desktop.png"), fullPage: true });
  await page.evaluate(() => window.qaAllowUpload());
  await page.getByRole("button", { name: "Enviar e processar" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("Catálogo atualizado: produtos.csv")).toBeVisible({ timeout: 10000 });
  await expect(page.getByText("Estoque no ERP: 0 ajustes confirmados; 1 aguardando confirmação.")).toBeVisible();
  await page.getByRole("button", { name: "Ver detalhes" }).click();
  await expect(page.getByText("O estoque deve ser um número inteiro maior ou igual a zero.")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toContain("invalid_stock_quantity");
  await page.screenshot({ path: resolve(output, "import-result-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const titleLayout = await page.getByText("Catálogo atualizado: produtos.csv").evaluate(element => ({
    width: element.clientWidth, contentWidth: element.scrollWidth, whiteSpace: getComputedStyle(element).whiteSpace,
  }));
  expect(titleLayout.width).toBeGreaterThan(180);
  expect(titleLayout.contentWidth).toBeLessThanOrEqual(titleLayout.width);
  expect(titleLayout.whiteSpace).not.toBe("nowrap");
  await page.screenshot({ path: resolve(output, "import-result-mobile.png"), fullPage: true });
  await page.evaluate(() => window.qaConfirmErp());
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByText("Estoque no ERP: 1 ajustes confirmados; 0 aguardando confirmação.")).toBeVisible();
  expect(errors).toEqual([]);
  const result = { status: "passed", assertions: ["file validation", "MIME fallback", "queue error recovery", "partial catalog success", "separate ERP status", "human row errors", "manual ERP refresh", "mobile overflow", "mobile title readable"], api: "fixtures", network: "loopback only", browser: "Chromium" };
  await writeFile(resolve(output, "result.json"), JSON.stringify(result, null, 2));
  process.stdout.write(JSON.stringify(result) + "\n");
} finally {
  await browser?.close();
  await server.close();
}
