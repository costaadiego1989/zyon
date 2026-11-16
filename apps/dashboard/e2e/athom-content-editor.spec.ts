import { test, expect, type Page } from "@playwright/test";

async function faqServer(page: Page) {
  const records = new Map<string, any>(), writes: any[] = [];
  await page.route("**/__qa/faqs**", async route => {
    const request = route.request();
    if (request.method() === "GET") return route.fulfill({ json: [...records.values()] });
    if (request.method() === "DELETE") {
      records.delete(decodeURIComponent(new URL(request.url()).pathname.split("/").pop()!));
      return route.fulfill({ json: { deleted: true } });
    }
    const body = request.postDataJSON(); writes.push(body);
    if (body.id && !records.has(body.id)) return route.fulfill({ status: 404, json: { code: "product_content_resource_not_found" } });
    const record = { ...body, id: body.id ?? "server-faq-1", productId: "qa-product" };
    records.set(record.id, record); return route.fulfill({ status: body.id ? 200 : 201, json: record });
  });
  return { records, writes };
}

test("FAQ creates without an update ID and retains server identity across reload, edit and delete", async ({ page }) => {
  const server = await faqServer(page);
  await page.goto("/athom-content-editor.html");
  const editor = page.getByRole("region", { name: "FAQs", exact: true });
  await editor.getByRole("button", { name: "Adicionar FAQ", exact: true }).click();
  await editor.getByRole("textbox", { name: "Pergunta", exact: true }).fill("Como funciona o QA?");
  await editor.getByRole("textbox", { name: "Resposta", exact: true }).fill("Resposta de teste.");
  await editor.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(editor.getByText("Como funciona o QA?", { exact: true })).toBeVisible();
  expect(server.writes).toHaveLength(1); expect(server.writes[0]).not.toHaveProperty("id");
  expect(server.records.get("server-faq-1").answer).toBe("Resposta de teste.");
  await page.reload();
  await expect(editor.getByText("Como funciona o QA?", { exact: true })).toBeVisible();
  await editor.getByRole("button", { name: "Editar", exact: true }).click();
  await editor.getByRole("textbox", { name: "Resposta", exact: true }).fill("Resposta editada.");
  await editor.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(editor.getByText("Resposta editada.", { exact: true })).toBeVisible();
  expect(server.writes[1].id).toBe("server-faq-1");
  page.once("dialog", dialog => dialog.accept());
  await editor.getByRole("button", { name: "Excluir", exact: true }).click();
  await expect(editor.getByText("Como funciona o QA?", { exact: true })).toHaveCount(0);
  expect(server.records.size).toBe(0);
});

test("FAQ empty fields do not dispatch creation", async ({ page }) => {
  const server = await faqServer(page); await page.goto("/athom-content-editor.html");
  await page.getByRole("button", { name: "Adicionar FAQ", exact: true }).click();
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Pergunta", exact: true })).toBeVisible();
  expect(server.writes).toHaveLength(0);
});
