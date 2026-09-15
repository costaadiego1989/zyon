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
      const createDataChannel = RTCPeerConnection.prototype.createDataChannel;
      Object.defineProperty(RTCPeerConnection.prototype, "createDataChannel", {
        configurable: true,
        value: function (...args: any[]) {
          const channel = createDataChannel.apply(this, args);
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
  });
});
