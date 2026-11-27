import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { marketingHttpFixture } from "../marketing-http.fixture.js";
import { marketingStages } from "../../../../../dashboard/src/api/marketing.js";
import {
  marketingBrowserFixture,
  expect,
} from "../../../../../dashboard/tests/marketing-browser.fixture.mjs";

test("marketing workspace follows the ads layout and clears filters without losing contacts or mobile actions", async () => {
  const api = await marketingHttpFixture();
  try {
    const browser = await marketingBrowserFixture(api, {
      entry: "marketing-shell-entry.tsx",
    });
    try {
      await browser.page.emulateMedia({ reducedMotion: "reduce" });
      await browser.page.route("**/zyon-z.png", (route) =>
        route.fulfill({ path: "apps/dashboard/public/zyon-z.png" })
      );
      await browser.page.route("**/v1/**", (route) => {
        const pathname = new URL(route.request().url()).pathname;
        if (pathname.startsWith("/v1/marketing")) return route.continue();
        return route.fulfill({
          json:
            pathname.endsWith("/domains") || pathname.endsWith("/notifications")
              ? []
              : {
                  plan: "growth",
                  status: "active",
                  data: [],
                  stores: [],
                  items: [],
                  total: 0,
                },
        });
      });
      const url = `${browser.url}&user=${api.users.owner.id}#marketing`;
      const screens = ".specs/features/marketing-ui/screens";
      await mkdir(screens, { recursive: true });
      await browser.page.goto(url);
      await expect(
        browser.page.getByText("Nenhum contato neste filtro", { exact: true })
      ).toBeVisible();
      await browser.page.screenshot({
        path: `${screens}/empty-desktop.png`,
        fullPage: true,
      });
      await browser.page.getByRole("link", { name: "Abrir conversas" }).click();
      await expect(
        browser.page.getByRole("heading", { name: "Conversas", exact: true })
      ).toBeVisible();
      assert.equal(new URL(browser.page.url()).hash, "#conversations");

      const names = [
        "Marina Costa",
        "Rafael Almeida",
        "Camila Souza",
        "Pedro Santos",
        "Juliana Lima",
        "Lucas Oliveira",
      ];
      await api.repository.transaction(
        api.merchantId,
        "ui-preview",
        async (tx) => {
          for (const [index, stage] of marketingStages.entries()) {
            await tx.saveContact(
              api.contact({
                name: names[index],
                stage,
                phone: `551198765432${index}`,
                origin: index % 2 ? "site" : "whatsapp",
                channels: [index % 2 ? "site" : "whatsapp"],
              })
            );
          }
        }
      );
      await browser.page.goto(url);
      await expect(
        browser.page.getByRole("button", { name: "Ver contato", exact: true })
      ).toHaveCount(6);
      await expect(
        browser.page.getByText("6 contatos identificados", { exact: true })
      ).toBeVisible();
      await browser.page.screenshot({
        path: `${screens}/contacts-desktop.png`,
        fullPage: true,
      });

      const contrast = await browser.page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const context = canvas.getContext("2d")!;
        const rgba = (color: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = color;
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data];
        };
        const luminance = (values: number[]) =>
          values
            .slice(0, 3)
            .map((value) => {
              const channel = value / 255;
              return channel <= 0.04045
                ? channel / 12.92
                : ((channel + 0.055) / 1.055) ** 2.4;
            })
            .reduce(
              (total, value, index) =>
                total + value * [0.2126, 0.7152, 0.0722][index],
              0
            );
        return [
          ".marketing-stage__label",
          ".marketing-stage small",
          ".marketing-section-heading p",
          ".marketing-contact-cell small",
          ".marketing-origin[data-channel=whatsapp]",
        ].map((selector) => {
          const element = document.querySelector(selector)!;
          let background = [0, 0, 0, 255];
          for (
            let node: Element | null = element;
            node;
            node = node.parentElement
          ) {
            const candidate = rgba(getComputedStyle(node).backgroundColor);
            if (candidate[3] === 255) {
              background = candidate;
              break;
            }
          }
          const foreground = luminance(rgba(getComputedStyle(element).color)),
            back = luminance(background);
          return {
            selector,
            ratio:
              (Math.max(foreground, back) + 0.05) /
              (Math.min(foreground, back) + 0.05),
          };
        });
      });
      for (const sample of contrast)
        assert.ok(sample.ratio >= 4.5, `contrast below AA: ${sample.selector}`);
      await writeFile(
        `${screens}/contrast.json`,
        JSON.stringify(contrast, null, 2)
      );
      await browser.page.getByRole("button", { name: /^Em compra/ }).click();
      await browser.page
        .getByRole("searchbox", { name: "Nome, telefone ou e-mail" })
        .fill("Contato inexistente");
      await browser.page
        .getByRole("combobox", { name: "Leads e compradores" })
        .selectOption("customer");
      await expect(
        browser.page.getByRole("button", {
          name: "Limpar filtros",
          exact: true,
        })
      ).toBeVisible();
      await browser.page.screenshot({
        path: `${screens}/filtered-empty-desktop.png`,
        fullPage: true,
      });
      await browser.page
        .getByRole("button", { name: "Limpar filtros", exact: true })
        .click();
      await expect(
        browser.page.getByRole("button", { name: "Ver contato", exact: true })
      ).toHaveCount(6);
      await expect(
        browser.page.getByRole("searchbox", {
          name: "Nome, telefone ou e-mail",
        })
      ).toHaveValue("");
      await expect(
        browser.page.getByRole("combobox", { name: "Leads e compradores" })
      ).toHaveValue("");
      await expect(
        browser.page.getByRole("button", { name: "Limpar etapa", exact: true })
      ).toHaveCount(0);

      for (const width of [1024, 390, 320]) {
        await browser.page.setViewportSize({ width, height: 1000 });
        assert.equal(
          await browser.page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          ),
          true,
          `viewport overflow at ${width}`
        );
        await expect(
          browser.page
            .getByRole("button", { name: "Ver contato", exact: true })
            .first()
        ).toBeVisible();
        if (width < 600)
          await expect(
            browser.page.locator(".marketing-mobile-origin").first()
          ).toBeVisible();
        if (width < 600) {
          await browser.page.screenshot({
            path: `${screens}/overview-${width}.png`,
            fullPage: true,
          });
          await browser.page
            .locator(".marketing-contact-list")
            .scrollIntoViewIfNeeded();
        }
        await browser.page.screenshot({
          path: `${screens}/contacts-${width}.png`,
          fullPage: true,
        });
      }
      await browser.page.setViewportSize({ width: 1440, height: 1000 });
      await browser.page
        .getByRole("tab", { name: "Campanhas", exact: true })
        .click();
      await expect(
        browser.page.getByRole("button", {
          name: "Criar campanha",
          exact: true,
        })
      ).toBeVisible();
      await browser.page.screenshot({
        path: `${screens}/campaigns-desktop.png`,
        fullPage: true,
      });
      assert.deepEqual(browser.errors, []);
    } finally {
      await browser.close();
    }
  } finally {
    await api.cleanup();
  }
});
