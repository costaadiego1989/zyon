import { expect, type Page } from "@playwright/test";
import { setupApiMocks, type FlowStep } from "./api-mocks.js";

export const VOICE_BASE = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:5173";

export const VOICE_REGISTRATION_SEQUENCE: FlowStep[] = [
  "ask_email",
  "ask_cpf",
  "ask_phone",
  "ask_cep",
  "confirm_address",
  "ask_number",
  "show_shipping_options",
  "shipping_selected",
];

export async function installVoiceBrowserMocks(page: Page) {
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

export async function spokenCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    const w = window as Window & { __aacpSpoken?: string[] };
    return w.__aacpSpoken?.length ?? 0;
  });
}

export async function waitForVoicePrompt(page: Page, expected: RegExp) {
  const prompt = page.locator(".aacp-voice-caption__agent");
  await expect(prompt).toBeVisible({ timeout: 10_000 });
  await expect(prompt).toContainText(expected, { timeout: 10_000 });
}

export async function ensureListening(page: Page) {
  const mic = page.locator(".aacp-voice-mic");
  await expect(mic).toBeVisible({ timeout: 10_000 });
  await expect(mic).toBeEnabled({ timeout: 10_000 });

  if ((await mic.getAttribute("aria-pressed")) !== "true") {
    await mic.click();
    await expect(mic).toHaveAttribute("aria-pressed", "true", { timeout: 5_000 });
  }
}

export async function emitVoiceTranscript(page: Page, text: string) {
  await ensureListening(page);
  await page.evaluate((transcript) => {
    const w = window as Window & { __aacpEmitSpeech?: (value: string) => void };
    w.__aacpEmitSpeech?.(transcript);
  }, text);
}

export async function answerByVoice(page: Page, text: string) {
  await emitVoiceTranscript(page, text);
  await expect(page.locator(".aacp-voice-confirmation")).toBeVisible({ timeout: 5_000 });
  await expect(page.locator(".aacp-voice-confirmation")).toContainText(/Antes de enviar/i);
  await page.getByRole("button", { name: /Confirmar e enviar/i }).click();
}

export async function answerAndWaitForPrompt(page: Page, text: string, nextPrompt: RegExp) {
  const before = await spokenCount(page);
  await answerByVoice(page, text);
  await waitForVoicePrompt(page, nextPrompt);
  await expect.poll(() => spokenCount(page), { timeout: 10_000 }).toBeGreaterThan(before);
}

export async function openVoiceCheckout(page: Page, chatSequence: FlowStep[] = []) {
  await setupApiMocks(page, { chatSequence });
  await page.goto(VOICE_BASE);
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 10_000 });
  await page.getByRole("button", { name: /Comprar por voz/i }).click();
  await expect(page.locator("[data-channel='voice']")).toBeVisible({ timeout: 10_000 });
}

export async function completeVoiceRegistration(page: Page) {
  await waitForVoicePrompt(page, /nome/i);
  await expect.poll(() => spokenCount(page), { timeout: 10_000 }).toBeGreaterThan(0);
  await answerAndWaitForPrompt(page, "Joao Silva", /e-?mail/i);
  await answerAndWaitForPrompt(page, "joao ponto silva arroba exemplo ponto com", /cpf/i);
  await answerAndWaitForPrompt(page, "12345678900", /telefone/i);
  await answerAndWaitForPrompt(page, "11999990000", /cep|frete/i);
  await answerAndWaitForPrompt(page, "01310100", /endereco|rua/i);
  await answerAndWaitForPrompt(page, "sim esta correto", /numero|complemento/i);
  await answerByVoice(page, "123 apartamento 4B");
}

export async function selectVoiceShipping(page: Page, method: "PAC" | "Sedex" = "PAC") {
  const selector = page.locator(".aacp-shipping-selector");
  await expect(selector).toBeVisible({ timeout: 10_000 });
  await expect(selector).toContainText("PAC");
  await expect(selector).toContainText("Sedex");
  await answerAndWaitForPrompt(page, method, /cupom|pagamento|pagar/i);
}

export async function skipCouponByVoice(page: Page) {
  await answerAndWaitForPrompt(page, "nao tenho cupom", /pagamento|pagar|cartao|pix/i);
}
