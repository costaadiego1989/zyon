import { test, expect, type Page } from "@playwright/test";
import type { BuyerPurchase } from "../src/lib/viewmodels/useBuyerHub/types";

// Local component/API fixtures only. No real shipment, provider or delivery is claimed.
const item = { name: "Luminária de mesa", quantity: 1, unit_price: 120 };
const shipment: BuyerPurchase = {
  id: "purchase-physical", order_id: "order-physical", merchant_name: "Athom", has_tracking: true,
  tracking_items: [item], tracking_code: "AB123456789BR", tracking_status: "in_transit", carrier: "correios",
  tracking_url: "https://rastreamento.correios.com.br/app/index.php?objeto=AB123456789BR",
  tracking_events: [
    { status: "posted", occurred_at: "2026-10-03T12:00:00Z", location: "São Paulo, SP", description: "Objeto recebido pela transportadora." },
    { status: "in_transit", occurred_at: "2026-10-04T15:30:00Z", location: "Campinas, SP", description: "Em transferência para a unidade de entrega." },
  ], total: 120, items: [item], items_count: 1, currency: "BRL", created_at: "2026-10-02T12:00:00Z",
};

async function seed(page: Page, purchases: BuyerPurchase[], theme: "light" | "dark" = "light") {
  await page.addInitScript((mode) => {
    localStorage.setItem("zyon_buyer_token", "e30." + btoa(JSON.stringify({ sub: "tracking-buyer", email: "qa@example.invalid", exp: 4102444800 })) + ".local-fixture");
    localStorage.setItem("zyon-theme", mode);
  }, theme);
  await page.route("**/api/buyer/**", (route) => route.fulfill({ json: route.request().url().includes("/purchases")
    ? { items: purchases, next_cursor: null } : { global_user_id: "tracking-buyer", display_name: "Conta de teste", items: [] } }));
}

async function openHub(page: Page) {
  await page.goto("/?hub=1");
  await page.getByRole("tab", { name: "Rastreio", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Suas entregas", exact: true })).toBeVisible();
}

test("only confirmed physical shipments with real codes appear; mixed purchases use physical projection", async ({ page }) => {
  await seed(page, [
    { ...shipment, id: "digital", has_tracking: false, tracking_items: [], items: [{ ...item, name: "Curso digital" }], tracking_code: "DIGITAL1234" },
    { ...shipment, id: "pending", tracking_code: "pending:fc248e0c-329c-4584-ad3b-96f98a5b0367", carrier: "flat-rate" },
    { ...shipment, id: "uuid", tracking_code: "fc248e0c-329c-4584-ad3b-96f98a5b0367" },
    { ...shipment, id: "unconfirmed", has_tracking: undefined },
    { ...shipment, id: "missing-physical-items", tracking_items: [] },
    { ...shipment, id: "cancelled", tracking_status: "cancelled" },
    { ...shipment, id: "mixed", items: [item, { ...item, name: "Manual digital", quantity: 1 }], items_count: 2 },
  ]);
  await openHub(page);
  const panel = page.getByRole("tabpanel", { name: "Rastreio", exact: true });
  await expect(panel.getByRole("article")).toHaveCount(1);
  await expect(panel).toContainText("1 × Luminária de mesa");
  await expect(panel).not.toContainText("Curso digital");
  await expect(panel).not.toContainText("Manual digital");
  await expect(panel).not.toContainText("pending:");
  await expect(panel).not.toContainText("fc248e0c");
  await expect(panel).not.toContainText("flat-rate");
});

test("copying keeps the real code and history is chronological without invalid dates or invented milestones", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await seed(page, [{ ...shipment, tracking_events: [...shipment.tracking_events!,
    { status: "internal_provider_stage", occurred_at: "invalid-date", description: "Invalid event should be hidden" }] }]);
  await openHub(page);
  await page.getByRole("button", { name: "Copiar código de rastreio AB123456789BR" }).click();
  await expect(page.getByText("Código copiado.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("AB123456789BR");
  const history = page.getByRole("list", { name: "Histórico da entrega", exact: true });
  await expect(history.getByRole("listitem")).toHaveCount(2);
  await expect(history.locator("time").first()).toHaveAttribute("datetime", "2026-10-04T15:30:00Z");
  await expect(history.locator("time").last()).toHaveAttribute("datetime", "2026-10-03T12:00:00Z");
  await expect(page.getByText(/Invalid event|internal_provider_stage|Invalid Date|Previsão de entrega/)).toHaveCount(0);
  const link = page.getByRole("link", { name: "Acompanhar entrega", exact: true });
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect(link).toHaveAttribute("href", shipment.tracking_url!);
});

test("unsafe external URLs and internal carriers never become links or customer labels", async ({ page }) => {
  const urls = ["javascript:alert(1)", "data:text/html,unsafe", "//rastreamento.correios.com.br", "https://user:pass@example.com/track",
    "http://localhost/track", "https://127.0.0.1/track", "https://10.0.0.1/track", "https://[::1]/track", "https://shipping.internal/track", "httpx://example.com/track"];
  await seed(page, urls.map((tracking_url, index) => ({ ...shipment, id: `unsafe-${index}`, tracking_code: `SAFE1234${index}`,
    tracking_url, carrier: index % 2 ? "free_shipping" : "flat-rate", tracking_events: [], tracking_status: "provider_internal_pending" })));
  await openHub(page);
  const panel = page.getByRole("tabpanel", { name: "Rastreio", exact: true });
  await expect(panel.getByRole("article")).toHaveCount(urls.length);
  await expect(panel.getByRole("link")).toHaveCount(0);
  await expect(panel).not.toContainText("flat-rate");
  await expect(panel).not.toContainText("free_shipping");
  await expect(panel).not.toContainText("provider_internal_pending");
  await expect(panel).not.toContainText("Transportadora: Correios");
  await expect(panel.getByRole("heading", { name: "Rastreamento disponível" })).toHaveCount(urls.length);
});

test("delivered and returned shipments have truthful states while long history remains accessible", async ({ page }) => {
  const moreEvents = [
    ...shipment.tracking_events!,
    { status: "out_for_delivery", occurred_at: "2026-10-05T12:00:00Z", location: "Campinas, SP" },
    { status: "delivered", occurred_at: "2026-10-05T17:00:00Z", description: "Entrega confirmada pela transportadora." },
  ];
  await seed(page, [
    { ...shipment, id: "delivered", tracking_status: "delivered", tracking_events: moreEvents },
    { ...shipment, id: "returned", tracking_status: "returned", tracking_code: "BR987654321BR", tracking_events: [] },
  ]);
  await openHub(page);
  const completed = page.getByRole("region", { name: "Entregues", exact: true });
  await expect(completed.getByRole("heading", { name: "Entregue", level: 4, exact: true })).toBeVisible();
  await expect(completed.getByText("Entrega confirmada pela transportadora.")).toBeVisible();
  await completed.getByText("Ver histórico completo", { exact: true }).click();
  await expect(completed.getByText("Objeto recebido pela transportadora.")).toBeVisible();
  await expect(page.getByRole("region", { name: "Devolvidas", exact: true }).getByRole("heading", { name: "Devolvido", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Em andamento", exact: true })).toHaveCount(0);
});

test("digital and pending-only history has a clear empty state", async ({ page }) => {
  await seed(page, [{ ...shipment, has_tracking: false, tracking_items: [], tracking_code: null, tracking_events: [] }]);
  await openHub(page);
  await expect(page.getByText("Nenhuma entrega com rastreio", { exact: true })).toBeVisible();
  await expect(page.getByText(/Consulte os demais pedidos na aba Pedidos/)).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
});

for (const theme of ["light", "dark"] as const) for (const width of [390, 1440]) {
  test(`tracking panel remains readable at ${width}px ${theme}`, async ({ page }, info) => {
    info.annotations.push({ type: "scope", description: "Local synthetic UI/API fixture; no actual shipment or provider verification." });
    await page.setViewportSize({ width, height: 900 });
    await seed(page, [shipment, { ...shipment, id: "delivered", tracking_code: "CD987654321BR", tracking_status: "delivered",
      tracking_items: [{ name: "Cabo USB-C", quantity: 2, unit_price: 30 }],
      tracking_events: [{ status: "delivered", occurred_at: "2026-10-01T16:00:00Z", description: "Entrega confirmada pela transportadora." }] }], theme);
    await openHub(page);
    const panel = page.getByRole("tabpanel", { name: "Rastreio", exact: true });
    await expect(panel.getByRole("article")).toHaveCount(2);
    expect(await panel.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`tracking-local-${theme}-${width}.png`), fullPage: true });
    await panel.getByRole("region", { name: "Entregues", exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`tracking-local-${theme}-${width}-delivered.png`), fullPage: true });
  });
}
