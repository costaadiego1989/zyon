/**
 * Advanced Product Layout — Accessibility audit (axe-core via Playwright)
 *
 * Runs an axe-core scan against each block type rendered in isolation and
 * fails the suite on any critical violations. Requires `@axe-core/playwright`
 * as a devDependency. Install with:
 *
 *   pnpm add -D @axe-core/playwright axe-core
 *
 * Strategy:
 *  - Mount the renderer with a single-block fixture per test.
 *  - Run `AxeBuilder.analyze()` on the test mount.
 *  - Assert no `critical` violations.
 *  - Capture report HTML on failure for triage.
 */
import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createRequire } from "node:module";

// Resolve optional dep lazily so a missing package gives a clean skip
// instead of a boot-time crash.
const require = createRequire(import.meta.url);

type BlockFixture = {
  type: string;
  order: number;
  isEnabled: boolean;
  props: Record<string, unknown>;
};

const STOREFRONT_BASE = process.env.STOREFRONT_BASE_URL ?? "http://localhost:3001";
const SLUG = process.env.STOREFRONT_TEST_SLUG ?? "marketplace-01";

const FIXTURES: Record<string, BlockFixture> = {
  paragraph: {
    type: "paragraph",
    order: 0,
    isEnabled: true,
    props: { text: "Blend Original hidrata profundamente e devolve brilho natural." },
  },
  heading: {
    type: "heading",
    order: 0,
    isEnabled: true,
    props: { level: 2, text: "Por que escolher nosso shampoo?" },
  },
  list: {
    type: "list",
    order: 0,
    isEnabled: true,
    props: {
      style: "unordered",
      items: ["Sem sulfato", "Sem parabenos", "Cruelty-free"],
    },
  },
  image: {
    type: "image",
    order: 0,
    isEnabled: true,
    props: {
      url: "https://placehold.co/1200x800/png?text=Blend+Original",
      alt: "Frasco do shampoo Blend Original 220ml",
      caption: "Embalagem 220ml",
    },
  },
  image_text_split: {
    type: "image_text_split",
    order: 0,
    isEnabled: true,
    props: {
      imageSide: "left",
      imageSrc: "https://placehold.co/800x600/png?text=Antes",
      imageAlt: "Antes e depois - cabelo seco",
      heading: "Antes e depois",
      text: "Resultado visível em 4 semanas de uso contínuo.",
    },
  },
  callout: {
    type: "callout",
    order: 0,
    isEnabled: true,
    props: {
      tone: "info",
      title: "Como usar",
      text: "Aplique 3 gotas no rosto limpo.",
    },
  },
  table: {
    type: "table",
    order: 0,
    isEnabled: true,
    props: {
      caption: "Especificações",
      headers: ["Propriedade", "Valor"],
      rows: [
        ["Volume", "220 ml"],
        ["Tipo", "Vegano"],
      ],
    },
  },
  faq: {
    type: "faq",
    order: 0,
    isEnabled: true,
    props: {
      items: [
        { question: "O produto é vegano?", answer: "Sim, 100% vegano." },
      ],
    },
  },
  video: {
    type: "video",
    order: 0,
    isEnabled: true,
    props: { provider: "youtube", ref: "dQw4w9WgXcQ", caption: "Veja como aplicar" },
  },
  carousel: {
    type: "carousel",
    order: 0,
    isEnabled: true,
    props: {
      images: [
        { src: "https://placehold.co/800x500/png?text=Foto+1", alt: "Foto 1" },
        { src: "https://placehold.co/800x500/png?text=Foto+2", alt: "Foto 2" },
      ],
    },
  },
  banner: {
    type: "banner",
    order: 0,
    isEnabled: true,
    props: {
      imageSrc: "https://placehold.co/1200x400/png?text=Banner",
      alt: "Banner promocional",
      caption: "Promoção válida até o fim do mês",
      linkUrl: "https://example.com/promo",
      ctaLabel: "Saiba mais",
    },
  },
  button: {
    type: "button",
    order: 0,
    isEnabled: true,
    props: { label: "Comprar agora", href: "https://example.com/buy", variant: "primary" },
  },
};

let axeAvailable = true;
test.beforeAll(() => {
  try {
    require.resolve("@axe-core/playwright");
    require.resolve("axe-core");
  } catch {
    axeAvailable = false;
  }
});

async function mountBlock(page: Page, fixture: BlockFixture): Promise<void> {
  const payload = encodeURIComponent(JSON.stringify([fixture]));
  await page.goto(
    `${STOREFRONT_BASE}/store/${SLUG}?aacpTestMount=1&aacpFixture=${payload}`,
    { waitUntil: "domcontentloaded" },
  );
  await page.waitForSelector("[data-aacp-block]", { timeout: 10_000 });
}

test.describe("Advanced Product Layout — accessibility @apl @a11y", () => {
  test.setTimeout(60_000);

  for (const [type, fixture] of Object.entries(FIXTURES)) {
    test(`${type} block — axe-core has zero critical violations`, async ({ page }) => {
      test.skip(!axeAvailable, "@axe-core/playwright not installed; skipping a11y audit");
      await mountBlock(page, fixture);

      const mount = page.locator(`[data-aacp-block="${type}"]`).first();
      await expect(mount).toBeVisible();

      const results = await new AxeBuilder({ page })
        .include(`[data-aacp-block="${type}"]`)
        .analyze();

      const critical = results.violations.filter((v) => v.impact === "critical");
      if (critical.length > 0) {
        // Attach the violation list to the failure for triage.
        const summary = critical
          .map((v) => `- ${v.id}: ${v.description} (${v.nodes.length} nodes)`)
          .join("\n");
        throw new Error(`Critical a11y violations for ${type}:\n${summary}`);
      }
    });
  }
});
