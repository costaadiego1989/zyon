import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import {
  marketingBrowserFixture,
  expect,
} from "./marketing-browser.fixture.mjs";

test("shared funnel and distribution charts preserve snapshot semantics, live values, accessibility and small-screen layout", async () => {
  const fixture = await marketingBrowserFixture(
    {
      base: "http://127.0.0.1:39999/marketing",
      merchantId: "funnel-render-only",
      users: { owner: { token: "local-render-only" } },
    },
    { entry: "funnel-ui-entry.tsx" }
  );
  try {
    const { page } = fixture;
    const captures = ".specs/features/shared-funnel-ui/screens";
    await mkdir(captures, { recursive: true });
    await page.goto(fixture.url);
    const cards = page.locator(".stat-card");
    await expect(cards).toHaveCount(4);
    await expect(
      cards
        .filter({ hasText: "Oportunidades ativas" })
        .locator(".stat-card__value")
    ).toHaveText("44");
    await expect(
      cards
        .filter({ hasText: "Compra confirmada" })
        .locator(".stat-card__value")
    ).toHaveText("16");
    await expect(
      page.locator(".funnel-diagram__stages [data-funnel-stage]")
    ).toHaveCount(5);
    await expect(
      page.locator('.funnel-diagram__outcomes [data-funnel-stage="lost"]')
    ).toHaveCount(1);
    await page.getByRole("button", { name: /^Em compra/ }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Etapa: shopping · Origem: todas"
    );
    await page.getByRole("button", { name: /^Em compra/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toHaveText(
      "Etapa: todas · Origem: todas"
    );
    await page.keyboard.press("Space");
    await expect(page.getByRole("status")).toHaveText(
      "Etapa: shopping · Origem: todas"
    );
    await page
      .getByRole("figure", { name: "Origem dos contatos" })
      .getByRole("button", { name: /^Não identificada/ })
      .click();
    await expect(page.getByRole("status")).toHaveText(
      "Etapa: shopping · Origem: unknown"
    );
    const percentages = await page
      .locator(".distribution-chart__track > span")
      .evaluateAll((elements) =>
        elements.map((el) => parseFloat(el.style.width))
      );
    assert.deepEqual(percentages, [72, 25, 3]);
    const widths = await page
      .locator(".funnel-diagram__stages polygon")
      .evaluateAll((elements) =>
        elements.map((el) => {
          const p = el.points;
          return [p[1].x - p[0].x, p[2].x - p[3].x];
        })
      );
    assert.ok(widths.every((pair) => pair[0] > pair[1]));
    assert.ok(widths[0][0] > widths.at(-1)[1]);
    const contrast = await page
      .locator(".funnel-diagram__value")
      .evaluateAll((elements) => {
        const ctx = document.createElement("canvas").getContext("2d");
        const luminance = (color) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          return [...ctx.getImageData(0, 0, 1, 1).data]
            .slice(0, 3)
            .map((v) => {
              v /= 255;
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        };
        return elements.map((element) => {
          const a = luminance(getComputedStyle(element).color),
            b = luminance(
              getComputedStyle(element.parentElement.querySelector("polygon"))
                .fill
            );
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        });
      });
    assert.ok(
      contrast.every((ratio) => ratio >= 4.5),
      JSON.stringify(contrast)
    );
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true,
        `Marketing overflow ${width}`
      );
      await page.screenshot({
        path: `${captures}/marketing-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
    await page
      .getByRole("button", { name: "Atualizar dados", exact: true })
      .click();
    await expect(
      cards
        .filter({ hasText: "Contatos identificados" })
        .locator(".stat-card__value")
    ).toHaveText("101");
    await expect(
      page.locator('[data-funnel-stage="new"] .funnel-diagram__amount strong')
    ).toHaveText("39");
    await page
      .getByRole("button", { name: "Dados indisponíveis", exact: true })
      .click();
    await expect(cards.first().locator(".stat-card__value")).toHaveText("—");
    await page
      .getByRole("button", { name: "Sem contatos", exact: true })
      .click();
    await expect(cards.first().locator(".stat-card__value")).toHaveText("0");
    await expect(
      page.getByText("Nenhum registro nesta base.", { exact: true })
    ).toBeVisible();
    await expect(page.locator("body")).not.toContainText("NaN");
    await page.getByRole("tab", { name: "Conversão", exact: true }).click();
    await expect(page.locator("[data-funnel-stage]")).toHaveCount(5);
    await expect(
      page.locator(".funnel-diagram__stages [data-funnel-stage]")
    ).toHaveCount(4);
    await expect(
      page
        .getByRole("list", { name: "Eventos complementares" })
        .locator('[data-funnel-stage="coupon_applied"]')
    ).toHaveCount(1);
    const proportional = await page
      .locator(".funnel-diagram__stages polygon")
      .evaluateAll((elements) =>
        elements.map((el) => el.points[1].x - el.points[0].x)
      );
    assert.ok(Math.abs(proportional[1] / proportional[0] - 0.6) < 0.001);
    assert.ok(Math.abs(proportional[3] / proportional[0] - 0.12) < 0.001);
    await expect(
      page.getByText("12.0% conversão", { exact: true })
    ).toBeVisible();
    await expect(
      page.locator(
        '[data-funnel-stage="shipping_selected"] .funnel-diagram__detail'
      )
    ).toHaveCount(0);
    await expect(
      page.locator(
        '[data-funnel-stage="coupon_applied"] .funnel-diagram__detail'
      )
    ).toHaveCount(0);
    await expect(
      page.locator(
        '[data-funnel-stage="payment_started"] .funnel-diagram__detail'
      )
    ).toHaveText("83% saiu antes de pedido confirmado");
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true,
        `Conversion overflow ${width}`
      );
      await page.screenshot({
        path: `${captures}/conversion-${width}.png`,
        fullPage: true,
        animations: "disabled",
      });
    }
    await page.getByRole("tab", { name: "Resultados", exact: true }).click();
    await expect(
      page.getByRole("figure", { name: "Situação dos envios" })
    ).toBeVisible();
    await expect(
      cards
        .filter({ hasText: "Receita atribuída" })
        .locator(".stat-card__value")
    ).toHaveText("Indisponível");
    const delivery = await page
      .locator(".distribution-chart__track > span")
      .evaluateAll((elements) =>
        elements.map((el) => parseFloat(el.style.width))
      );
    assert.deepEqual(delivery, [20, 20, 30, 10, 10, 10]);
    assert.deepEqual(fixture.errors, []);
  } finally {
    await fixture.close();
  }
});
