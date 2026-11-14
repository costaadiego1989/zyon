import { test, expect, type Page, type ConsoleMessage } from "@playwright/test";

// ── Helpers ──────────────────────────────────────────────────────────────────

async function loginIfNeeded(page: Page): Promise<void> {
  const emailInput = page.locator("input[placeholder='owner@loja.com']");
  const isLoginPage = await emailInput.isVisible({ timeout: 2000 }).catch(() => false);
  if (isLoginPage) {
    await emailInput.click();
    await emailInput.pressSequentially("demo@zyon.com", { delay: 50 });
    await page.waitForTimeout(300);
    const passwordInput = page.locator("input[type='password']");
    await passwordInput.click();
    await passwordInput.pressSequentially("demo1234", { delay: 50 });
    await page.waitForTimeout(300);
    await page.locator("button[type='submit']").click();
    await page.waitForTimeout(3000);
  }
}

async function gotoRootAndLogin(page: Page): Promise<void> {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await loginIfNeeded(page);
  // Wait for navigation rail to be ready (logged in)
  await page.waitForTimeout(800);
}

async function gotoTab(page: Page, label: string): Promise<void> {
  await page.locator(`text=${label}`).first().click();
  // Allow route transition + data load
  await page.waitForTimeout(1500);
}

function attachConsoleCollector(page: Page): { errors: string[]; warnings: string[]; detach: () => void } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const onMessage = (msg: ConsoleMessage) => {
    const text = msg.text();
    if (msg.type() === "error") errors.push(text);
    if (msg.type() === "warning") warnings.push(text);
  };
  const onPageError = (err: Error) => {
    errors.push(`pageerror: ${err.message}`);
  };
  page.on("console", onMessage);
  page.on("pageerror", onPageError);
  return {
    errors,
    warnings,
    detach: () => {
      page.off("console", onMessage);
      page.off("pageerror", onPageError);
    },
  };
}

// ── Theme Module ─────────────────────────────────────────────────────────────

test.describe("Theme Module", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await gotoRootAndLogin(page);
  });

  test("@theme-load theme page renders", async ({ page }) => {
    await gotoTab(page, "Tema");

    // Page heading visible
    await expect(page.locator("h1", { hasText: /Aparência/i })).toBeVisible({ timeout: 5000 });

    // At least one of the key sections is rendered
    const sections = page.locator("section, .panel, [class*='panel']");
    const count = await sections.count();
    expect(count).toBeGreaterThan(0);
  });

  test("@theme-controls color/style inputs visible", async ({ page }) => {
    await gotoTab(page, "Tema");

    // Wait for controls panel to render (not the skeleton)
    await page.waitForSelector("input[type='color']", { timeout: 8000 });

    // Color pickers for the palette
    const colorInputs = page.locator("input[type='color']");
    const colorCount = await colorInputs.count();
    expect(colorCount).toBeGreaterThan(0);

    // Hex text inputs mirror each color
    const textInputs = page.locator("input[type='text']");
    const textCount = await textInputs.count();
    expect(textCount).toBeGreaterThan(0);

    // Font selector (select element)
    const selects = page.locator("select");
    const selectCount = await selects.count();
    expect(selectCount).toBeGreaterThan(0);

    // Border-radius range
    const range = page.locator("input[type='range']");
    expect(await range.count()).toBeGreaterThan(0);
  });

  test("@theme-preview preview section visible", async ({ page }) => {
    await gotoTab(page, "Tema");

    // Live preview lives in a sticky preview column
    const previewColumn = page.locator(".split-panel-preview");
    await expect(previewColumn).toBeVisible({ timeout: 8000 });

    // Preview header chrome present
    const previewHeader = previewColumn.locator("text=Preview");
    await expect(previewHeader.first()).toBeVisible({ timeout: 5000 });
  });

  test("@theme-save save button exists", async ({ page }) => {
    await gotoTab(page, "Tema");

    // The Salvar button is the primary CTA in the page header
    const saveBtn = page.locator("button", { hasText: /Salvar/i }).first();
    await expect(saveBtn).toBeVisible({ timeout: 5000 });
    await expect(saveBtn).toBeEnabled();
  });

  test("@theme-no-js-errors no critical JS errors", async ({ page }) => {
    const collector = attachConsoleCollector(page);
    try {
      await gotoTab(page, "Tema");

      // Interact lightly to surface any runtime issues
      const colorInput = page.locator("input[type='color']").first();
      if (await colorInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await colorInput.click();
      }

      // Filter out benign noise: favicon, resource loads (401/500), react devtools
      const filtered = collector.errors.filter(
        (e) =>
          !/favicon|net::ERR_FAILED|Failed to load resource/i.test(e) &&
          !/Download the React DevTools/i.test(e),
      );
      expect(filtered).toEqual([]);
    } finally {
      collector.detach();
    }
  });
});

// ── Embed Module ─────────────────────────────────────────────────────────────

test.describe("Embed Module", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(async ({ page }) => {
    await gotoRootAndLogin(page);
  });

  test("@embed-load embed page renders", async ({ page }) => {
    await gotoTab(page, "Embed");

    // Heading
    await expect(page.locator("h1", { hasText: /Instale/i })).toBeVisible({ timeout: 5000 });

    // Three numbered steps (use headings to avoid strict mode violations)
    const step1 = page.getByRole("heading", { name: /Configurar sessão/i });
    const step2 = page.getByRole("heading", { name: /Permissões/i });
    const step3 = page.getByRole("heading", { name: /Cole no seu HTML/i });
    await expect(step1).toBeVisible();
    await expect(step2).toBeVisible();
    await expect(step3).toBeVisible();
  });

  test("@embed-code embed code block/snippet visible", async ({ page }) => {
    await gotoTab(page, "Embed");

    // Snippet is rendered inside <pre><code>
    const codeBlock = page.locator("pre code").first();
    await expect(codeBlock).toBeVisible({ timeout: 5000 });

    // Contains the embed script tag
    const text = (await codeBlock.textContent()) ?? "";
    expect(text).toContain("<script");
    expect(text).toContain("/widget/aacp.js");
    expect(text).toContain("data-aacp-token");
  });

  test("@embed-copy copy button exists", async ({ page }) => {
    await gotoTab(page, "Embed");

    const copyBtn = page.locator("button", { hasText: /Copiar/i }).first();
    await expect(copyBtn).toBeVisible({ timeout: 5000 });
    await expect(copyBtn).toBeEnabled();
  });

  test("@embed-no-js-errors no critical JS errors", async ({ page }) => {
    const collector = attachConsoleCollector(page);
    try {
      await gotoTab(page, "Embed");

      // Interact lightly
      const originInput = page.locator("#embed-origin");
      if (await originInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await originInput.click();
      }

      // Filter out benign noise: favicon, resource loads (401/500), react devtools
      const filtered = collector.errors.filter(
        (e) =>
          !/favicon|net::ERR_FAILED|Failed to load resource/i.test(e) &&
          !/Download the React DevTools/i.test(e),
      );
      expect(filtered).toEqual([]);
    } finally {
      collector.detach();
    }
  });
});