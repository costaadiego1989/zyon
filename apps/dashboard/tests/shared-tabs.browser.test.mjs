import { test } from "node:test";
import assert from "node:assert/strict";
import {
  marketingBrowserFixture,
  expect,
} from "./marketing-browser.fixture.mjs";

test("shared tabs preserve keyboard, panel relationships, filter semantics and visible icons on small screens", async () => {
  const fixture = await marketingBrowserFixture(
    {
      base: "http://127.0.0.1:39999/marketing",
      merchantId: "local-components-only",
      users: { owner: { token: "local-components-only" } },
    },
    { entry: "shared-tabs-entry.tsx" }
  );
  try {
    const { page } = fixture;
    await page.goto(fixture.url);
    const tabs = page.getByRole("tablist", { name: "Áreas", exact: true });
    await expect(tabs.getByRole("tab", { selected: true })).toHaveText(
      "Contatos e funil"
    );
    await tabs.getByRole("tab", { name: "Contatos e funil" }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.getByRole("tab", { name: "Campanhas" })).toBeFocused();
    await expect(page.getByRole("tabpanel")).toHaveAttribute(
      "aria-labelledby",
      "campaigns-tab"
    );
    await page.keyboard.press("End");
    await expect(
      tabs.getByRole("tab", { name: "Configurações de comunicação" })
    ).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await expect(
      tabs.getByRole("tab", { name: "Contatos e funil" })
    ).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(
      tabs.getByRole("tab", { name: "Configurações de comunicação" })
    ).toBeFocused();
    await page.keyboard.press("Home");
    await expect(
      tabs.getByRole("tab", { name: "Contatos e funil" })
    ).toBeFocused();
    const filters = page.getByRole("group", { name: "Filtrar resultados" });
    await expect(filters.getByRole("tab")).toHaveCount(0);
    await filters.getByRole("button", { name: "Ativos" }).click();
    await expect(
      filters.getByRole("button", { name: "Ativos" })
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("status")).toHaveText("Filtro: active");
    await page
      .getByRole("tablist", { name: "Período dos indicadores" })
      .getByRole("tab", { name: "30 dias", exact: true })
      .click();
    await expect(page.getByText("Período: 30d", { exact: true })).toBeVisible();
    const contrast = await page.evaluate(() => {
      const context = document.createElement("canvas").getContext("2d");
      const luminance = (color) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = color;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data]
          .slice(0, 3)
          .map((v) => {
            v /= 255;
            return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          })
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      };
      return [...document.querySelectorAll(".tab-bar__tab")].map((button) => {
        let parent = button,
          background = "";
        while (parent) {
          background = getComputedStyle(parent).backgroundColor;
          if (background !== "rgba(0, 0, 0, 0)" && background !== "transparent")
            break;
          parent = parent.parentElement;
        }
        const foreground = luminance(getComputedStyle(button).color),
          back = luminance(background);
        return (
          (Math.max(foreground, back) + 0.05) /
          (Math.min(foreground, back) + 0.05)
        );
      });
    });
    assert.ok(
      contrast.every((value) => value >= 4.5),
      JSON.stringify(contrast)
    );
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await tabs
        .getByRole("tab", { name: "Configurações de comunicação" })
        .click();
      const measurements = await page.evaluate(() => {
        const buttons = [...document.querySelectorAll(".tab-bar__tab")];
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          icons: buttons.every(
            (button) =>
              button
                .querySelector('.tab-bar__icon[aria-hidden="true"] svg')
                ?.getBoundingClientRect().width === 16
          ),
          heights: buttons.map(
            (button) => button.getBoundingClientRect().height
          ),
          tabOverflow:
            document.querySelector(".tab-bar").scrollWidth >
            document.querySelector(".tab-bar").clientWidth,
          visibleSelected: [
            ...document
              .querySelector(".tab-bar")
              .querySelectorAll('[role="tab"][aria-selected="true"]'),
          ].every((button) => {
            const rect = button.getBoundingClientRect(),
              parent = button.parentElement.getBoundingClientRect();
            return (
              rect.left >= parent.left - 1 && rect.right <= parent.right + 1
            );
          }),
        };
      });
      assert.equal(measurements.overflow, false);
      assert.equal(measurements.icons, true);
      assert.equal(
        measurements.visibleSelected,
        true,
        JSON.stringify({ width, ...measurements })
      );
      assert.ok(
        measurements.heights.every(
          (height) => height >= (width <= 640 ? 44 : 40)
        ),
        JSON.stringify({ width, ...measurements })
      );
      if (width <= 390) assert.equal(measurements.tabOverflow, true);
    }
    assert.deepEqual(fixture.errors, []);
  } finally {
    await fixture.close();
  }
});
