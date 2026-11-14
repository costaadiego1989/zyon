import { test } from "@playwright/test";

// Throwaway probe: dump the real nav DOM so we can build a correct helper.
test("@probe dump nav structure", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  const nav = page.locator("nav").first();
  await nav.waitFor({ state: "visible", timeout: 15_000 });

  const info = await page.evaluate(() => {
    const navs = Array.from(document.querySelectorAll("nav")).map((n) => ({
      ariaLabel: n.getAttribute("aria-label"),
      buttonTexts: Array.from(n.querySelectorAll("button")).map((b) => (b.textContent || "").trim().slice(0, 40)).filter(Boolean),
      linkTexts: Array.from(n.querySelectorAll("a")).map((a) => (a.textContent || "").trim().slice(0, 40)).filter(Boolean),
    }));
    return { navCount: navs.length, navs };
  });
  console.log("NAV_DUMP_START" + JSON.stringify(info) + "NAV_DUMP_END");
});
