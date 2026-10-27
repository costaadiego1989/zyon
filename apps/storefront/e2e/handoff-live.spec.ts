import { test, expect } from "@playwright/test";

test("handoff via storefront UI creates real ticket", async ({ page }) => {
  await page.goto("http://localhost:3001/store/cosmos", { waitUntil: "domcontentloaded", timeout: 15000 });
  await page.waitForTimeout(3000);

  // Step 1: Click "Por chat" to enter ConversationShell
  const chatBtn = page.locator('button:has-text("Por chat"), button:has-text("chat")');
  const chatCount = await chatBtn.count();
  console.log(`[0] "Por chat" button count: ${chatCount}`);
  if (chatCount > 0) {
    await chatBtn.first().click();
    await page.waitForTimeout(2000);
  }

  // Debug: log all buttons after entering chat
  const allButtons = await page.locator("button").allTextContents();
  console.log(`[1] Buttons after chat entry (${allButtons.length}):`, allButtons.map(b => b.trim().slice(0, 30)).filter(Boolean));

  // Step 2: Click support button (title="Suporte")
  const supportBtn = page.locator('button[title="Suporte"]');
  let supportCount = await supportBtn.count();
  console.log(`[2] button[title="Suporte"] count: ${supportCount}`);

  if (supportCount === 0) {
    // Try alt selectors
    const altBtn = page.locator('button[aria-label*="suporte" i], button[title*="uporte"]');
    supportCount = await altBtn.count();
    console.log(`[2b] Alt support: ${supportCount}`);
    if (supportCount > 0) await altBtn.first().click();
  } else {
    await supportBtn.first().click();
  }

  await page.waitForTimeout(1000);

  if (supportCount === 0) {
    await page.screenshot({ path: "e2e/screenshots/handoff-fail-no-support.png" });
    // Log page HTML snippet
    const html = await page.content();
    console.log("[FAIL] Page HTML snippet:", html.slice(0, 1000));
    throw new Error("No support button found");
  }

  // Step 3: Click "Falar com atendente"
  const falarBtn = page.locator('button:has-text("Falar com atendente")');
  const falarCount = await falarBtn.count();
  console.log(`[3] 'Falar com atendente' count: ${falarCount}`);

  if (falarCount === 0) {
    await page.screenshot({ path: "e2e/screenshots/handoff-fail-no-falar.png" });
    throw new Error("No 'Falar com atendente' button");
  }

  // Listen for console logs from the browser
  page.on("console", (msg) => {
    if (msg.text().includes("SupportPanel") || msg.text().includes("support")) {
      console.log(`[BROWSER] ${msg.text()}`);
    }
  });

  // Listen for network
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("support") || url.includes("checkout-token")) {
      const body = await response.text().catch(() => "");
      console.log(`[NET] ${url} → ${response.status()} ${body.slice(0, 150)}`);
    }
  });

  await falarBtn.first().click();
  await page.waitForTimeout(8000); // Wait for token + API + response

  // Step 4: Check panel response
  const panel = page.locator('#support-panel');
  const panelExists = await panel.count();
  let panelText = "";
  if (panelExists > 0) {
    panelText = await panel.textContent() ?? "";
  } else {
    panelText = await page.locator("body").textContent() ?? "";
  }
  console.log(`[4] Response text (last 400): ${panelText.slice(-400)}`);

  await page.screenshot({ path: "e2e/screenshots/handoff-result.png" });

  const hasTicketRef = panelText.includes("chamado") || panelText.includes("Referência") || panelText.includes("referência");
  console.log(`[5] Has ticket reference: ${hasTicketRef}`);
  expect(hasTicketRef).toBe(true);
});
