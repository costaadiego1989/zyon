import { test, expect } from "@playwright/test";

/**
 * E2E: Signup wizard saves company data to storeSettings.
 * Creates a new merchant, then navigates to store-settings and verifies fields.
 */

const UNIQUE = `e2e${Date.now()}`;
const TEST_MERCHANT = {
  personName: "Diego Tester",
  businessName: `Loja ${UNIQUE}`,
  cnpj: "11222333000181",
  cnpjFormatted: "11.222.333/0001-81",
  email: `test${UNIQUE}@e2e.local`,
  password: "Teste@2026!",
  phone: "21993001883",
  phoneFormatted: "(21) 99300-1883",
};

test.describe("Signup → Store Settings persistence", () => {
  test("signup wizard saves CNPJ and phone to storeSettings", async ({ page }) => {
    await page.goto("/");

    // Click "Criar conta" tab
    await page.getByRole("tab", { name: "Criar conta" }).click();

    // Step 1: Person
    await page.getByRole("textbox", { name: "Ana Souza" }).fill(TEST_MERCHANT.personName);
    await page.getByRole("combobox").selectOption("Proprietário(a)");
    await page.getByRole("button", { name: "Continuar" }).click();

    // Step 2: Business
    await page.getByRole("textbox", { name: "Loja Aurora" }).fill(TEST_MERCHANT.businessName);
    await page.getByRole("textbox", { name: "/0000-00" }).fill(TEST_MERCHANT.cnpj);
    await page.getByRole("button", { name: "Continuar" }).click();

    // Step 3: Account
    await page.getByRole("textbox", { name: "voce@sualoja.com.br" }).fill(TEST_MERCHANT.email);
    await page.getByRole("textbox", { name: "Mínimo 8 caracteres" }).fill(TEST_MERCHANT.password);
    await page.getByRole("textbox", { name: "Repita a senha" }).fill(TEST_MERCHANT.password);
    await page.getByRole("textbox", { name: "(11) 99999-9999" }).fill(TEST_MERCHANT.phone);

    // Submit signup
    await page.getByRole("button", { name: "Criar conta" }).click();

    // Wait for dashboard to load
    await page.locator("nav").waitFor({ state: "visible", timeout: 15000 });

    // Navigate to store settings page
    await page.getByText("Configurações").first().click();
    await page.waitForTimeout(2000);

    // Verify fields are pre-populated with signup data
    // Razão Social should have the business name
    const razaoSocialField = page.locator('input[placeholder="Empresa LTDA"]');
    await expect(razaoSocialField).toHaveValue(TEST_MERCHANT.businessName);

    // Email should be pre-populated
    const emailField = page.locator('input[placeholder="contato@empresa.com"]');
    await expect(emailField).toHaveValue(TEST_MERCHANT.email);

    // CNPJ saved (digits only in DB, displayed formatted or raw)
    const cnpjField = page.locator('input[placeholder="00.000.000/0000-00"]');
    const cnpjValue = await cnpjField.inputValue();
    expect(cnpjValue.replace(/\D/g, "")).toBe(TEST_MERCHANT.cnpj);

    // Phone saved
    const phoneField = page.locator('input[placeholder="(11) 99999-9999"]');
    const phoneValue = await phoneField.inputValue();
    expect(phoneValue.replace(/\D/g, "")).toBe(TEST_MERCHANT.phone);

    console.log("✅ All store settings fields verified from signup data!");
  });
});
