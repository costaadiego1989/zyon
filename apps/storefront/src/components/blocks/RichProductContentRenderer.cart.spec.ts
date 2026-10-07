import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const storefrontRequire = createRequire(path.resolve(directory, "../../../package.json"));
const apiRequire = createRequire(path.resolve(directory, "../../../../api/package.json"));
const { chromium, expect } = storefrontRequire("@playwright/test");
const ts = apiRequire("typescript");
const transpile = (name: string) => ts.transpileModule(fs.readFileSync(path.resolve(directory, name), "utf8"), {
  fileName: name, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;

test("real product panel settles only its add result, shows refusal immediately, and blocks an uncertain retry", async () => {
  const browser = await chromium.launch({ headless: true });
  const evidenceDir = process.env.ZYON_QA_CART_EVIDENCE_DIR;
  const checks: string[] = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
    const errors: string[] = []; page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.route("**/*", (route: any) => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("http://product-cart.test/");
    for (const [dependency, filename] of [["react", "react.development.js"], ["react-dom", "react-dom.development.js"]]) {
      await page.addScriptTag({ content: fs.readFileSync(path.join(path.dirname(storefrontRequire.resolve(dependency)), "umd", filename), "utf8") });
    }
    await page.addStyleTag({ content: `:root { --aacp-font: Arial, sans-serif; --aacp-bg:#fafafa; --aacp-text:#202020; --aacp-muted:#606060; --aacp-line:#ddd; --aacp-accent:#6548dc; } * { box-sizing:border-box; } body { margin:0; font-family:Arial,sans-serif; padding:24px; } #root { max-width:1000px; margin:auto; }` + fs.readFileSync(path.join(directory, "RichProductContent.module.css"), "utf8") });
    await page.evaluate(({ panel, cartAction, foodSelection, schedule, selector, preference }: { panel: string; cartAction: string; foodSelection: string; schedule: string; selector: string; preference: string }) => {
      const win = window as any, React = win.React;
      const actionModule = { exports: {} as any };
      new Function("module", "exports", cartAction)(actionModule, actionModule.exports);
      const foodModule = { exports: {} as any };
      new Function("module", "exports", foodSelection)(foodModule, foodModule.exports);
      const scheduleModule = { exports: {} as any }, selectorModule = { exports: {} as any };
      new Function("module", "exports", schedule)(scheduleModule, scheduleModule.exports);
      const preferenceModule = { exports: {} as any };
      new Function("require", "module", "exports", preference)(() => React, preferenceModule, preferenceModule.exports);
      const Null = () => null, Icon = () => React.createElement("span", { "aria-hidden": true }, "·");
      const dependencies = (name: string) => {
        if (name === "react") return React;
        if (name.endsWith("one-buy-click-presentation")) return preferenceModule.exports;
        if (name === "react-icons/fi") return new Proxy({}, { get: () => Icon });
        if (name.endsWith("rich-product-cart-action")) return actionModule.exports;
        if (name.endsWith("food-selection")) return foodModule.exports;
        if (name.endsWith("service-schedule")) return scheduleModule.exports;
        if (name.endsWith("ServiceScheduleSelector")) return selectorModule.exports;
        if (name.endsWith("useGallerySwipe")) return { useGallerySwipe: () => ({}) };
        if (name.endsWith("product-narration")) return { buildProductNarration: () => "" };
        if (name.endsWith("ProductCardShare")) return { ProductCardShare: Null };
        if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_obj, key) => key }) };
        if (["./RuleNotices", "./ProductContentRenderer", "./ProductNarration"].includes(name)) return { default: Null };
        throw new Error(`Unexpected module: ${name}`);
      };
      const module = { exports: {} as any };
      new Function("require", "module", "exports", "React", selector)(dependencies, selectorModule, selectorModule.exports, React);
      new Function("require", "module", "exports", "React", panel)(dependencies, module, module.exports, React);
      const Panel = module.exports.default, root = win.ReactDOM.createRoot(document.getElementById("root"));
      const purchase = { productName: "Hambúrguer da casa", defaultVariantId: "burger", priceReais: 25, currency: "BRL", images: [],
        variants: [{ id: "burger", attributes: {}, available: true, priceReais: 25, currency: "BRL", lowStock: false }],
        optionGroups: [{ id: "extras", name: "Adicionais", required: true, selectionType: "single", items: [{ id: "cheese", name: "Queijo", priceModifierInCents: 500 }] }] };
      win.renderPanel = (productId: string, changes: object = {}) => win.ReactDOM.flushSync(() => root.render(React.createElement(Panel, {
        blocks: [], faqs: [], testimonials: [], videos: [], productId, purchase: { ...purchase, ...changes }, narrationEnabled: false,
        onCartAdded: () => { win.added++; },
      })));
      win.added = 0; win.commands = []; win.requests = []; win.resolvers = []; win.cartOpened = 0;
      window.addEventListener("aacp:open-rich-product-cart", () => { win.cartOpened++; });
      window.addEventListener("aacp:add-rich-product-to-cart", (event) => {
        win.requests.push((event as CustomEvent).detail);
        void actionModule.exports.submitRichProductCart((event as CustomEvent).detail, async (message: string) => {
          win.commands.push(message);
          return new Promise(resolve => win.resolvers.push(resolve));
        }, (result: unknown) => window.dispatchEvent(new CustomEvent("aacp:rich-product-cart-result", { detail: result })), false);
      });
      win.resolveTurn = (status: string, code?: string) => win.resolvers.shift()({ agentMessage: "Texto de teste", blocks: [
        { type: "cart_add_result", data: { cartId: "conversation", variantId: "burger", status, code } },
      ] });
      win.renderPanel("product-1");
    }, { panel: transpile("RichProductContentRenderer.tsx"), cartAction: transpile("../../lib/rich-product-cart-action.ts"), foodSelection: transpile("../../lib/food-selection.ts"), schedule: transpile("../../lib/service-schedule.ts"), selector: transpile("ServiceScheduleSelector.tsx"), preference: transpile("../../lib/one-buy-click-presentation.tsx") });
    const add = page.locator("[data-aacp-rich-product-add-to-cart]");
    await add.click(); await expect(page.getByRole("alert")).toContainText("Escolha adicionais");
    assert.equal(await page.evaluate(() => (window as any).commands.length), 0); checks.push("required-option-prevents-request");
    await page.getByLabel("Queijo").check(); await add.click(); await expect(add).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("aacp:rich-product-cart-result", {
      detail: { requestId: "old-request", variantId: "burger", status: "succeeded" },
    })));
    await expect(add).toHaveText(/Adicionando/); assert.equal(await page.evaluate(() => (window as any).added), 0); checks.push("stale-result-ignored");
    await page.evaluate(() => (window as any).resolveTurn("rejected", "variant_out_of_stock"));
    await expect(page.getByRole("alert")).toContainText("não está disponível em estoque"); await expect(add).toBeEnabled();
    await expect(page.getByText("Quantidade indisponível", { exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => (window as any).added), 0); checks.push("stock-refusal-immediate-no-success");
    if (evidenceDir) { fs.mkdirSync(evidenceDir, { recursive: true }); await page.screenshot({ path: path.join(evidenceDir, "stock-refusal-desktop.png"), fullPage: true }); }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)); checks.push("mobile-no-overflow");
    if (evidenceDir) await page.screenshot({ path: path.join(evidenceDir, "stock-refusal-mobile.png"), fullPage: true });
    await add.click(); await page.evaluate(() => (window as any).resolveTurn("succeeded"));
    await expect(add).toContainText("Adicionar mais um"); assert.equal(await page.evaluate(() => (window as any).added), 1); checks.push("matching-success-only");
    const openCart = page.getByRole("button", { name: "Ver carrinho", exact: true });
    await expect(openCart).toHaveAttribute("data-neu", "text");
    await expect(add).toHaveAttribute("data-neu", "primary");
    await openCart.click();
    assert.equal(await page.evaluate(() => (window as any).cartOpened), 1);
    assert.equal(await page.evaluate(() => (window as any).commands.length), 2); checks.push("cart-link-opens-without-adding-another-item");
    await add.click(); await page.evaluate(() => (window as any).resolveTurn("unknown"));
    await expect(add).toBeDisabled(); await expect(page.getByRole("button", { name: "Confira o carrinho", exact: true })).toBeEnabled();
    assert.equal(await page.evaluate(() => (window as any).commands.length), 3); checks.push("unknown-outcome-blocks-resubmit");
    if (evidenceDir) await page.screenshot({ path: path.join(evidenceDir, "unknown-add-mobile.png"), fullPage: true });
    const previous = await page.evaluate(() => (window as any).requests.at(-1));
    await page.evaluate(() => (window as any).renderPanel("product-2")); await expect(add).toBeEnabled();
    await page.evaluate((detail: object) => window.dispatchEvent(new CustomEvent("aacp:rich-product-cart-result", { detail: { ...detail, status: "succeeded" } })), previous);
    await expect(add).toContainText("Adicionar ao carrinho"); assert.equal(await page.evaluate(() => (window as any).added), 1); checks.push("product-change-fences-old-operation");
    await page.evaluate(() => (window as any).renderPanel("bounded-food", { optionGroups: [{
      id: "extras", name: "Adicionais", required: true, selectionType: "multiple", minSelections: 2, maxSelections: 2,
      items: [{ id: "cheese", name: "Queijo", priceModifierInCents: 500 }, { id: "bacon", name: "Bacon", priceModifierInCents: 450 }, { id: "onion", name: "Cebola", priceModifierInCents: 300 }],
    }] }));
    await page.getByLabel("Queijo").check(); await add.click(); await expect(page.getByRole("alert")).toContainText("pelo menos 2");
    assert.equal(await page.evaluate(() => (window as any).commands.length), 3); checks.push("minimum-selection-prevents-request");
    await page.getByLabel("Bacon").check(); await expect(page.getByLabel("Cebola")).toBeDisabled();
    await page.getByLabel("Bacon").uncheck(); await expect(page.getByLabel("Cebola")).toBeEnabled(); await page.getByLabel("Cebola").check();
    await expect(page.getByText("R$ 33,00", { exact: true })).toBeVisible(); checks.push("maximum-and-price-follow-selected-options");
    await add.click(); assert.equal((await page.evaluate(() => (window as any).commands)).at(-1), "Adicionar produto ao carrinho [variantId:burger] [optionItemIds:cheese,onion]");
    await page.evaluate(() => (window as any).resolveTurn("succeeded")); await expect(add).toContainText("Adicionar mais um");
    if (evidenceDir) await page.screenshot({ path: path.join(evidenceDir, "food-bounds-mobile.png"), fullPage: true });
    assert.deepEqual(errors, []);
    if (evidenceDir) fs.writeFileSync(path.join(evidenceDir, "results.json"), JSON.stringify({ passed: true, checks,
      scope: "Actual React product renderer and add bridge in Chromium; controlled transport/provider responses, no real purchase or provider delivery." }, null, 2));
  } finally { await browser.close(); }
});

test("legacy product card enforces the same food bounds and emits only the buyer's chosen IDs", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors: string[] = []; page.on("pageerror", (error: Error) => errors.push(error.message));
    await page.route("**/*", (route: any) => route.fulfill({ contentType: "text/html", body: '<div id="root"></div>' }));
    await page.goto("http://legacy-food.test/");
    for (const [dependency, filename] of [["react", "react.development.js"], ["react-dom", "react-dom.development.js"]]) {
      await page.addScriptTag({ content: fs.readFileSync(path.join(path.dirname(storefrontRequire.resolve(dependency)), "umd", filename), "utf8") });
    }
    await page.evaluate(({ card, options, cta, selection, schedule, selector, preference, presentation }: { card: string; options: string; cta: string; selection: string; schedule: string; selector: string; preference: string; presentation: string }) => {
      const win = window as any, React = win.React, Null = () => null;
      const modules = new Map<string, any>();
      const dependencies = (name: string) => {
        if (name === "react") return React;
        if (name.endsWith("one-buy-click-presentation")) return modules.get("preference");
        if (name.endsWith("product-presentation")) return modules.get("presentation");
        if (name.endsWith("food-selection")) return modules.get("selection");
        if (name.endsWith("service-schedule")) return modules.get("schedule");
        if (name.endsWith("ServiceScheduleSelector")) return modules.get("selector");
        if (name.endsWith(".module.css")) return { default: new Proxy({}, { get: (_obj, key) => key }) };
        if (name.endsWith("ProductCardOptions")) return modules.get("options");
        if (name.endsWith("ProductCardCta")) return modules.get("cta");
        if (name.endsWith("color")) return { isColorToken: () => false };
        if (name.endsWith("RuleNotices")) return { default: Null };
        if (name.endsWith("StarRating")) return { StarRating: Null };
        if (name.endsWith("ProductCardMedia")) return { ProductCardMedia: Null };
        if (name.endsWith("ProductCardVariants")) return { ProductCardVariants: Null };
        throw new Error(`Unexpected module: ${name}`);
      };
      for (const [key, source] of [["presentation", presentation], ["preference", preference], ["selection", selection], ["schedule", schedule], ["selector", selector], ["options", options], ["cta", cta], ["card", card]]) {
        const module = { exports: {} as any };
        new Function("require", "module", "exports", "React", source)(dependencies, module, module.exports, React);
        modules.set(key, module.exports);
      }
      const data = { id: "burger-product", name: "Hambúrguer", price: 2500, priceFormatted: "R$ 25,00", inStock: true,
        variants: [{ id: "burger", name: "Versão", value: "Padrão", price: 2500, stock: 10 }],
        optionGroups: [{ id: "extras", name: "Adicionais", required: true, selectionType: "multiple", minSelections: 2, maxSelections: 2,
          items: [{ id: "cheese", name: "Queijo", priceModifierInCents: 500 }, { id: "bacon", name: "Bacon", priceModifierInCents: 450 }, { id: "onion", name: "Cebola", priceModifierInCents: 300 }] }] };
      win.legacyCommands = [];
      win.ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(modules.get("card").default, {
        block: { type: "product_card", data }, onQuickReply: (command: string) => win.legacyCommands.push(command),
      }));
    }, { card: transpile("ProductCardBlock.tsx"), options: transpile("parts/ProductCardOptions.tsx"), cta: transpile("parts/ProductCardCta.tsx"), selection: transpile("../../lib/food-selection.ts"), schedule: transpile("../../lib/service-schedule.ts"), selector: transpile("ServiceScheduleSelector.tsx"), preference: transpile("../../lib/one-buy-click-presentation.tsx"), presentation: transpile("../../lib/product-presentation.ts") });
    await expect(page.getByRole("button", { name: "Comprar agora", exact: true })).toBeDisabled();
    await page.getByRole("checkbox", { name: /Queijo/ }).click(); await expect(page.getByRole("button", { name: "Comprar agora", exact: true })).toBeDisabled();
    await page.getByRole("checkbox", { name: /Bacon/ }).click(); await expect(page.getByRole("checkbox", { name: /Cebola/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Adicionar ao carrinho", exact: true })).toBeEnabled();
    await expect(page.getByText("R$ 34,50", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Adicionar ao carrinho", exact: true }).click();
    const commands = await page.evaluate(() => (window as any).legacyCommands);
    assert.equal(commands.length, 1); assert.match(commands[0], /\[variantId:burger\]/); assert.match(commands[0], /\[optionItemIds:cheese,bacon\]/);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
