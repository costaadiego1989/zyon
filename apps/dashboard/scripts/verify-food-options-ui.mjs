import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const dashboardRoot = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(process.argv[2] ?? resolve(dashboardRoot, "test-results/food-options"));
const moduleId = "virtual:qa-food-options.jsx";
const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { ProductForm } from '/src/pages/product-detail/components/ProductForm.tsx';
import { useProductForm } from '/src/pages/product-detail/hooks/useProductForm.ts';
import { validateProductMetadata } from '/src/pages/product-detail/utils/product-validation.ts';
import '/src/styles.css';
const initial = { name:'Hambúrguer da casa', type:'food', isActive:true, metadata:{ optionGroups:[{
  id:'extras',name:'Adicionais',required:true,selectionType:'multiple',minSelections:2,maxSelections:2,
  items:[{id:'cheese',name:'Queijo',priceModifierInCents:500},{id:'bacon',name:'Bacon',priceModifierInCents:1000},{id:'onion',name:'Cebola',priceModifierInCents:300}]
}]}};
function App() {
  const form = useProductForm();
  React.useEffect(() => { form.loadProduct(initial); }, [form.loadProduct]);
  window.qaReloadFood = price => form.loadProduct(price === false ? initial : {...initial, metadata:{optionGroups:[{...initial.metadata.optionGroups[0], items:[{...initial.metadata.optionGroups[0].items[0],priceModifierInCents:price},...initial.metadata.optionGroups[0].items.slice(1)]}]}});
  window.qaFoodState = {groups:form.optionGroups};
  const errors = validateProductMetadata(form.productType, {...form.metadata, optionGroups:form.optionGroups});
  return React.createElement('div', {style:{maxWidth:900, margin:'auto', padding:16}}, React.createElement(ProductForm, {
    name:form.name, onNameChange:form.setName, description:form.description, onDescriptionChange:form.setDescription,
    productType:form.productType, onProductTypeChange:form.setProductType, metadata:form.metadata, onMetadataChange:form.setMetadata,
    categoryId:form.categoryId, onCategoryIdChange:form.setCategoryId, isActive:form.isActive, onIsActiveChange:form.setIsActive,
    isEditing:true, categories:[], onCreateCategory:async()=>{throw Error('not used in this check')},
    generatingDesc:false, onGenerateDescription:()=>{}, formErrors:errors, optionGroups:form.optionGroups, onOptionGroupsChange:form.setOptionGroups,
  }));
}
createRoot(document.getElementById('root')).render(React.createElement(App));
`;
const server = await createServer({ root: dashboardRoot, configFile: false, plugins: [react(), {
  name: "qa-food-options", resolveId(id) { if (id === moduleId) return `\0${moduleId}`; },
  load(id) { if (id === `\0${moduleId}`) return fixture; },
  configureServer(dev) { dev.middlewares.use(async (req, res, next) => {
    if (req.url !== "/qa-food") return next();
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(await dev.transformIndexHtml("/qa-food", '<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/' + moduleId + '"></script></body></html>'));
  }); },
}], server: { host: "127.0.0.1", port: 0, fs: { allow: [resolve(dashboardRoot, "../..")] } } });
let browser;
const checks = [];
try {
  await mkdir(output, { recursive: true }); await server.listen();
  const address = server.httpServer.address(); browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
  page.setDefaultTimeout(10000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => { const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" && url.port === String(address.port) ? route.continue() : route.abort(); });
  await page.goto(`http://127.0.0.1:${address.port}/qa-food`);
  const minimum = page.getByLabel("Mínimo de escolhas"), maximum = page.getByLabel("Máximo de escolhas");
  await expect(minimum).toHaveValue("2"); await expect(maximum).toHaveValue("2");
  await expect(page.getByText("Acréscimo máximo: +R$ 15,00", { exact: true })).toBeVisible(); checks.push("loaded-bounds-and-correct-maximum-price");
  await maximum.fill("4"); await expect(page.getByRole("alert")).toContainText("Revise os limites");
  await expect(page.getByText("Revise as opções para calcular o acréscimo máximo.", { exact: true })).toBeVisible(); checks.push("invalid-bound-validated-in-form");
  await maximum.fill("2"); await expect(page.getByRole("alert")).toHaveCount(0);
  await minimum.fill("0"); await expect(page.getByLabel("Obrigatório", { exact: true })).not.toBeChecked(); checks.push("minimum-and-required-stay-consistent");
  await page.getByLabel("Obrigatório", { exact: true }).check(); await expect(minimum).toHaveValue("1");
  await page.getByRole("combobox", { name: "Seleção em Adicionais", exact: true }).selectOption("single"); await expect(minimum).toHaveCount(0);
  await expect(page.getByText("Acréscimo máximo: +R$ 10,00", { exact: true })).toBeVisible(); checks.push("single-selection-resets-bounds-and-preview");
  await page.evaluate(() => window.qaReloadFood(false)); await expect(minimum).toHaveValue("2");
  await page.screenshot({ path: resolve(output, "food-editor-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  if (overflow) throw Error("food editor horizontal overflow"); checks.push("mobile-editor-without-overflow");
  await page.screenshot({ path: resolve(output, "food-editor-mobile.png"), fullPage: true });
  await page.locator("section").filter({ has: page.getByRole("heading", { name: "Variações do produto", exact: true }) })
    .screenshot({ path: resolve(output, "food-bounds-editor-mobile.png") });
  for (const invalidPrice of ["invalid", null, "500"]) {
    await page.evaluate(price => window.qaReloadFood(price), invalidPrice);
    await expect(page.getByRole("alert")).toContainText("acréscimos");
    await expect(page.locator("body")).not.toContainText("NaN");
  }
  checks.push("malformed-price-never-becomes-valid-zero-or-nan");
  if (errors.length) throw Error(errors.join("\n"));
  await writeFile(resolve(output, "results.json"), JSON.stringify({ passed: true, checks,
    scope: "Actual ProductForm and useProductForm with controlled initial data and actual metadata validation; Chromium desktop/mobile. No authenticated edit/save against API or real store." }, null, 2));
  process.stdout.write(JSON.stringify({ passed: true, checks, output }) + "\n");
} finally { await browser?.close(); await server.close(); }
