import { expect, test, type Page } from "@playwright/test";
import { setupApiMocks, type FlowStep } from "./fixtures/api-mocks.js";

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

async function installVoiceBrowserMocks(page: Page) {
  await page.addInitScript(() => {
    (globalThis as { process?: { env: Record<string, string> } }).process = {
      env: { AACP_DISABLE_STREAMING: "1" },
    };

    const spoken: string[] = [];
    let activeRecognition: MockSpeechRecognition | null = null;

    class MockSpeechSynthesisUtterance {
      text: string;
      lang = "";
      rate = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(text: string) {
        this.text = text;
      }
    }

    class MockSpeechRecognition {
      lang = "";
      interimResults = false;
      maxAlternatives = 0;
      continuous = false;
      onstart: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onend: (() => void) | null = null;
      onresult: ((event: { results: Array<Array<{ transcript?: string }>> }) => void) | null = null;

      start(): void {
        activeRecognition = this;
        this.onstart?.();
      }

      stop(): void {
        if (activeRecognition === this) activeRecognition = null;
        this.onend?.();
      }

      abort(): void {
        if (activeRecognition === this) activeRecognition = null;
        this.onend?.();
      }
    }

    const w = window as Window & {
      SpeechRecognition?: typeof MockSpeechRecognition;
      webkitSpeechRecognition?: typeof MockSpeechRecognition;
      SpeechSynthesisUtterance?: typeof MockSpeechSynthesisUtterance;
      __aacpSpoken?: string[];
      __aacpEmitSpeech?: (text: string) => void;
    };

    w.__aacpSpoken = spoken;
    w.__aacpEmitSpeech = (text: string) => {
      if (!activeRecognition) {
        throw new Error("Voice recognition is not listening.");
      }
      const recognition = activeRecognition;
      activeRecognition = null;
      recognition.onresult?.({ results: [[{ transcript: text }]] });
      recognition.onend?.();
    };

    Object.defineProperty(w, "SpeechRecognition", {
      configurable: true,
      value: MockSpeechRecognition,
    });
    Object.defineProperty(w, "webkitSpeechRecognition", {
      configurable: true,
      value: MockSpeechRecognition,
    });
    Object.defineProperty(w, "SpeechSynthesisUtterance", {
      configurable: true,
      value: MockSpeechSynthesisUtterance,
    });
    Object.defineProperty(w, "speechSynthesis", {
      configurable: true,
      value: {
        cancel: () => {},
        speak: (utterance: MockSpeechSynthesisUtterance) => {
          spoken.push(utterance.text);
          utterance.onstart?.();
          window.setTimeout(() => utterance.onend?.(), 0);
        },
      },
    });
  });
}

async function spokenCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Window & { __aacpSpoken?: string[] };
    return w.__aacpSpoken?.length ?? 0;
  });
}

async function waitForPrompt(page: Page, expected: RegExp) {
  const prompt = page.locator(".aacp-voice-caption__agent");
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await expect(prompt).toContainText(expected, { timeout: 10_000 });
}

async function ensureListening(page: Page) {
  const mic = page.locator(".aacp-voice-mic");
  await expect(mic).toBeVisible({ timeout: 10_000 });
  await expect(mic).toBeEnabled({ timeout: 10_000 });

  if ((await mic.getAttribute("aria-pressed")) !== "true") {
    await mic.click();
    await expect(mic).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });
  }
}

async function answerByVoice(page: Page, text: string) {
  await ensureListening(page);
  await page.evaluate((transcript) => {
    const w = window as Window & { __aacpEmitSpeech?: (value: string) => void };
    w.__aacpEmitSpeech?.(transcript);
  }, text);
  await expect(page.locator(".aacp-voice-confirmation")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator(".aacp-voice-confirmation")).toContainText(/Antes de enviar/i);
  await page.getByRole("button", { name: /Confirmar e enviar/i }).click();
}

async function answerAndWaitForPrompt(page: Page, text: string, nextPrompt: RegExp) {
  const before = await spokenCount(page);
  await answerByVoice(page, text);
  await waitForPrompt(page, nextPrompt);
  await expect.poll(() => spokenCount(page), { timeout: 10_000 }).toBeGreaterThan(before);
}

test.beforeEach(async ({ page }) => {
  await installVoiceBrowserMocks(page);
});

test.describe("Voice checkout flow", () => {
  test.setTimeout(90_000);

  test("speaks every step and reaches Stripe card payment after confirmed voice commands", async ({
    page,
  }) => {
    const fullSequence: FlowStep[] = [
      "ask_email",
      "ask_cpf",
      "ask_phone",
      "ask_cep",
      "confirm_address",
      "ask_number",
      "show_shipping_options",
      "shipping_selected",
    ];

    await setupApiMocks(page, { chatSequence: fullSequence });
    await page.goto(BASE);

    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /Comprar por voz/i }).click();

    await expect(page.locator("[data-channel='voice']")).toBeVisible({ timeout: 10_000 });
    await waitForPrompt(page, /nome/i);
    await expect.poll(() => spokenCount(page), { timeout: 10_000 }).toBeGreaterThan(0);

    await answerAndWaitForPrompt(page, "Joao Silva", /e-?mail/i);
    await answerAndWaitForPrompt(page, "joao ponto silva arroba exemplo ponto com", /cpf/i);
    await answerAndWaitForPrompt(page, "12345678900", /telefone/i);
    await answerAndWaitForPrompt(page, "11999990000", /cep|frete/i);
    await answerAndWaitForPrompt(page, "01310100", /endereco|rua/i);
    await answerAndWaitForPrompt(page, "sim esta correto", /numero|complemento/i);

    await answerByVoice(page, "123 apartamento 4B");
    const selector = page.locator(".aacp-shipping-selector");
    await expect(selector).toBeVisible({ timeout: 10_000 });
    await expect(selector).toContainText("PAC");
    await expect(selector).toContainText("Sedex");

    await answerAndWaitForPrompt(page, "PAC", /cupom|pagamento|pagar/i);
    await answerAndWaitForPrompt(page, "nao tenho cupom", /pagamento|pagar|cartao|pix/i);

    const cardIntentRequest = page.waitForRequest((request) => {
      if (!request.url().includes("/payment/intents") || request.method() !== "POST") {
        return false;
      }
      try {
        return JSON.parse(request.postData() ?? "{}").method === "card";
      } catch {
        return false;
      }
    });

    await answerByVoice(page, "cartao de credito");
    const request = await cardIntentRequest;
    expect(JSON.parse(request.postData() ?? "{}")).toMatchObject({ method: "card" });

    await expect(page.locator(".aacp-stripe-element-wrap")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".aacp-voice-caption__agent")).toContainText(
      /cartao|valor|confirmar/i,
      { timeout: 10_000 },
    );
  });
});
