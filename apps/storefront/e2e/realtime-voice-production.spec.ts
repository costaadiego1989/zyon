import { expect, test } from "@playwright/test";

const productionUrl = process.env.ZYON_VOICE_PRODUCTION_URL;

/**
 * This consumes a single ephemeral client secret only. It never exposes a
 * permanent provider key and does not submit checkout data or payment.
 */
test.describe("Realtime voice production @voice", () => {
  test.skip(!productionUrl, "Set ZYON_VOICE_PRODUCTION_URL to a Growth storefront for this opt-in smoke test.");

  test("starts the Growth welcome greeting without browser speech synthesis", async ({ page }) => {
    let sessionStatus: number | undefined;
    let realtimeCallStatus: number | undefined;
    page.on("response", (response) => {
      if (response.url().includes("/realtime/session")) {
        sessionStatus = response.status();
      }
      if (response.url() === "https://api.openai.com/v1/realtime/calls") {
        realtimeCallStatus = response.status();
      }
    });
    await page.addInitScript(() => {
      const nativeSpeech = { calls: 0 };
      (window as any).__zyonNativeSpeech = nativeSpeech;
      const realtimeEvents: string[] = [];
      (window as any).__zyonRealtimeEvents = realtimeEvents;
      const realtimeInboundEvents: string[] = [];
      (window as any).__zyonRealtimeInboundEvents = realtimeInboundEvents;
      const realtimeChannels: RTCDataChannel[] = [];
      (window as any).__zyonRealtimeChannels = realtimeChannels;
      const createDataChannel = RTCPeerConnection.prototype.createDataChannel;
      Object.defineProperty(RTCPeerConnection.prototype, "createDataChannel", {
        configurable: true,
        value: function (...args: any[]) {
          const channel = createDataChannel.apply(this, args);
          realtimeChannels.push(channel);
          channel.addEventListener("message", (event) => realtimeInboundEvents.push(String(event.data)));
          const send = channel.send.bind(channel);
          Object.defineProperty(channel, "send", {
            configurable: true,
            value: (data: unknown) => {
              realtimeEvents.push(String(data));
              return send(data);
            },
          });
          return channel;
        },
      });
      Object.defineProperty(window, "speechSynthesis", {
        configurable: true,
        value: { cancel: () => {}, getVoices: () => [], speak: () => { nativeSpeech.calls += 1; } },
      });
      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      const oscillator = audioContext.createOscillator();
      oscillator.connect(destination);
      oscillator.start();
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => destination.stream,
      });
    });

    await page.goto(productionUrl!, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Começar por voz" })).toBeVisible();
    await expect(page.getByRole("status")).toBeVisible();
    await expect.poll(() => Boolean(sessionStatus && sessionStatus >= 200 && sessionStatus < 300), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => Boolean(realtimeCallStatus && realtimeCallStatus >= 200 && realtimeCallStatus < 300), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).__zyonRealtimeEvents.some((event: string) => event.includes('"type":"response.create"')))).toBe(true);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("zyon:realtime-product-summary", {
      detail: { summary: "Sérum capilar: produto de teste disponível para resumo por voz." },
    })));
    await expect.poll(() => page.evaluate(() => (window as any).__zyonRealtimeEvents.some((event: string) => event.includes("Sérum capilar: produto de teste disponível para resumo por voz.")))).toBe(true);
    await expect(page.locator("audio[data-zyon-realtime-audio]")).toHaveCount(1);
    await expect.poll(() => page.locator("audio[data-zyon-realtime-audio]").evaluate((audio) => Boolean(audio.srcObject)), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).__zyonNativeSpeech.calls)).toBe(0);

    await expect.poll(() => page.evaluate(() => (window as any).__zyonRealtimeInboundEvents.some((event: string) => event.includes("response.done") || event.includes("response.completed"))), { timeout: 20_000 }).toBe(true);

    // This is the same Realtime user turn produced after speech recognition.
    // It asks neither for payment nor for an order submission.
    await page.evaluate(() => {
      const channel = (window as any).__zyonRealtimeChannels.at(-1) as RTCDataChannel | undefined;
      channel?.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Quero finalizar meu pedido agora." }],
        },
      }));
      channel?.send(JSON.stringify({ type: "response.create" }));
    });
    await expect.poll(() => page.evaluate(() => (window as any).__zyonRealtimeEvents.some((event: string) => event.includes("function_call_output"))), { timeout: 20_000 }).toBe(true);
    await expect(page.getByRole("dialog")).toContainText("Para finalizar sua compra, confirme sua identidade", { timeout: 20_000 });
  });

  test("keeps a guest out of the login modal when quick checkout is active", async ({ page }) => {
    await page.addInitScript(() => {
      const realtimeEvents: string[] = [];
      (window as any).__zyonRealtimeEvents = realtimeEvents;
      const realtimeInboundEvents: string[] = [];
      (window as any).__zyonRealtimeInboundEvents = realtimeInboundEvents;
      const realtimeChannels: RTCDataChannel[] = [];
      (window as any).__zyonRealtimeChannels = realtimeChannels;
      const createDataChannel = RTCPeerConnection.prototype.createDataChannel;
      Object.defineProperty(RTCPeerConnection.prototype, "createDataChannel", {
        configurable: true,
        value: function (...args: any[]) {
          const channel = createDataChannel.apply(this, args);
          realtimeChannels.push(channel);
          channel.addEventListener("message", (event) => realtimeInboundEvents.push(String(event.data)));
          const send = channel.send.bind(channel);
          Object.defineProperty(channel, "send", {
            configurable: true,
            value: (data: unknown) => {
              realtimeEvents.push(String(data));
              return send(data);
            },
          });
          return channel;
        },
      });
      const audioContext = new AudioContext();
      const destination = audioContext.createMediaStreamDestination();
      const oscillator = audioContext.createOscillator();
      oscillator.connect(destination);
      oscillator.start();
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        configurable: true,
        value: async () => destination.stream,
      });
    });

    await page.goto(productionUrl!, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /Come.*por voz/ }).click();
    const quickToggle = page.locator('[data-one-buy-click-toggle="header"]');
    await expect(quickToggle).toBeVisible({ timeout: 20_000 });
    await expect(quickToggle).toBeEnabled({ timeout: 20_000 });
    if (await quickToggle.getAttribute("aria-checked") !== "true") await quickToggle.click();
    await expect(quickToggle).toHaveAttribute("aria-checked", "true");

    // Reload reproduces the reported timing: voice can receive the checkout
    // tool call while the remote preference request is still resolving.
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect.poll(() => page.evaluate(() => (window as any).__zyonRealtimeChannels.length > 0), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).__zyonRealtimeChannels.at(-1)?.readyState === "open"), { timeout: 20_000 }).toBe(true);
    await expect.poll(() => page.evaluate(() => (window as any).__zyonRealtimeInboundEvents.some((event: string) => event.includes("response.done") || event.includes("response.completed"))), { timeout: 20_000 }).toBe(true);

    await page.evaluate(() => {
      const channel = (window as any).__zyonRealtimeChannels.at(-1) as RTCDataChannel | undefined;
      channel?.send(JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Quero finalizar meu pedido agora." }],
        },
      }));
      channel?.send(JSON.stringify({ type: "response.create" }));
    });

    await expect.poll(() => page.evaluate(() => (window as any).__zyonRealtimeEvents.some((event: string) => event.includes("function_call_output"))), { timeout: 20_000 }).toBe(true);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Voltar/ })).toBeVisible();
  });
});
