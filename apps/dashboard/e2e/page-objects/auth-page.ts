/**
 * Auth page object — login, signup, and password recovery flows.
 */

import { type Page, type Locator, expect } from "@playwright/test";
import { BasePage } from "./base-page";
import { TIMEOUTS } from "../config";

export class AuthPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /* ── Locators ───────────────────────────────────────────────────── */

  get emailInput(): Locator {
    return this.page.locator("input[type='email']");
  }

  get passwordInput(): Locator {
    return this.page.locator("input[type='password']");
  }

  get submitButton(): Locator {
    return this.page.locator("button[type='submit']");
  }

  get loginTab(): Locator {
    return this.page.getByRole("tab", { name: /entrar/i });
  }

  get signupTab(): Locator {
    return this.page.getByRole("tab", { name: /criar conta/i });
  }

  get forgotPasswordLink(): Locator {
    return this.page.locator("button:has-text('Esqueceu?')");
  }

  get errorHint(): Locator {
    return this.page.locator(".auth-hint")
      .or(this.page.locator("[role='alert']"))
      .or(this.page.locator("[data-testid='auth-error']"));
  }

  get showPasswordToggle(): Locator {
    return this.page.locator("[aria-label='Mostrar senha'], [aria-label='Ocultar senha']");
  }

  get googleButton(): Locator {
    return this.page.locator("button:has-text('Google')");
  }

  get githubButton(): Locator {
    return this.page.locator("button:has-text('GitHub')");
  }

  get switchToSignupLink(): Locator {
    return this.page.locator("button:has-text('Criar conta')").last();
  }

  /* ── Actions ────────────────────────────────────────────────────── */

  /** Navigate to login page */
  async goto(): Promise<void> {
    await this.page.goto("/", { waitUntil: "domcontentloaded" });
    await this.emailInput.waitFor({ state: "visible", timeout: TIMEOUTS.auth });
  }

  /** Fill email field */
  async fillEmail(email: string): Promise<void> {
    await this.emailInput.fill(email);
  }

  /** Fill password field */
  async fillPassword(password: string): Promise<void> {
    await this.passwordInput.fill(password);
  }

  /** Click submit button */
  async submit(): Promise<void> {
    await this.submitButton.click();
  }

  /** Full login flow */
  async login(email: string, password: string): Promise<void> {
    await this.fillEmail(email);
    await this.fillPassword(password);
    await this.submit();
  }

  /** Wait for successful login (nav shell appears) */
  async waitForLoginSuccess(): Promise<void> {
    await this.waitForShell();
  }

  /** Wait for error hint to appear */
  async waitForError(): Promise<string> {
    await this.errorHint.waitFor({ state: "visible", timeout: TIMEOUTS.element });
    return this.errorHint.textContent() as Promise<string>;
  }

  /* ── Assertions ─────────────────────────────────────────────────── */

  /** Assert login form is visible */
  async assertLoginFormVisible(): Promise<void> {
    await expect(this.emailInput).toBeVisible({ timeout: TIMEOUTS.element });
    await expect(this.passwordInput).toBeVisible();
    await expect(this.submitButton).toBeVisible();
  }

  /** Assert submit button shows loading state */
  async assertSubmitLoading(): Promise<void> {
    await expect(this.submitButton).toHaveText(/aguarde/i);
    await expect(this.submitButton).toBeDisabled();
  }

  /** Assert we're on the login page */
  async assertIsLoginPage(): Promise<void> {
    await expect(this.emailInput).toBeVisible({ timeout: TIMEOUTS.auth });
  }
}
