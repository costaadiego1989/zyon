import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const directory = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.resolve(directory, "../../package.json"));
const apiRequire = createRequire(
  path.resolve(directory, "../../../api/package.json")
);
const { chromium, expect } = require("@playwright/test");
const ts = apiRequire("typescript");
const source = ts.transpileModule(
  fs.readFileSync(path.join(directory, "MarketingConsentOpening.tsx"), "utf8"),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.React,
    },
  }
).outputText;

test("MKT-02/4 opening choices are explicit keyboard-accessible gestures and neither blocks continuation", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [1440, 390, 320])
      for (const choice of ["granted", "declined"]) {
        const page = await browser.newPage({
          viewport: { width, height: 800 },
        });
        await page.route("**/*", (route: any) =>
          route.fulfill({
            contentType: "text/html",
            body: '<div id="root"></div>',
          })
        );
        await page.goto("http://opening.test/");
        for (const [dependency, filename] of [
          ["react", "react.development.js"],
          ["react-dom", "react-dom.development.js"],
        ]) {
          await page.addScriptTag({
            content: fs.readFileSync(
              path.join(
                path.dirname(require.resolve(dependency)),
                "umd",
                filename
              ),
              "utf8"
            ),
          });
        }
        const css = fs.readFileSync(
          path.join(directory, "MarketingConsentOpening.module.css"),
          "utf8"
        );
        await page.addStyleTag({
          content: `:root{--aacp-fg:#15151a;--aacp-bg:#fff;--aacp-card:#f4f4f6;--aacp-line:#b9b9c1;--aacp-accent:#6f4dd9;} ${css}`,
        });
        await page.evaluate((source: string) => {
          const win = window as any,
            React = win.React;
          const module = { exports: {} as any };
          new Function("require", "module", "exports", "React", source)(
            (name: string) =>
              name === "./MarketingConsentOpening.module.css"
                ? {
                    default: {
                      opening: "opening",
                      content: "content",
                      question: "question",
                      actions: "actions",
                    },
                  }
                : React,
            module,
            module.exports,
            React
          );
          win.choices = [];
          const root = win.ReactDOM.createRoot(document.getElementById("root"));
          function Probe() {
            const [choice, setChoice] = React.useState(null);
            return choice
              ? React.createElement(
                  "p",
                  { role: "status" },
                  "Atendimento disponível"
                )
              : React.createElement(module.exports.MarketingConsentOpening, {
                  storeName: "Loja Local",
                  onChoice: (value: string) => {
                    win.choices.push(value);
                    setChoice(value);
                  },
                });
          }
          root.render(React.createElement(Probe));
        }, source);
        await expect(
          page.getByRole("heading", { name: "Antes de começar" })
        ).toBeVisible();
        assert.deepEqual(
          await page.evaluate(() => (window as any).choices),
          []
        );
        assert.equal(
          await page.evaluate(
            () => localStorage.length + sessionStorage.length
          ),
          0
        );
        const button = page.getByRole("button", {
          name: choice === "granted" ? "Quero receber" : "Agora não",
          exact: true,
        });
        await button.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByRole("status")).toHaveText(
          "Atendimento disponível"
        );
        assert.deepEqual(await page.evaluate(() => (window as any).choices), [
          choice,
        ]);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
          ),
          false
        );
        await page.close();
      }
  } finally {
    await browser.close();
  }
});
