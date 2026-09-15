import { expect, test } from "@playwright/test";

test("voice can reveal visual payment methods without creating a payment", async ({ page }) => {
  let checkoutAdvanceCalls = 0;
  let paymentRequests = 0;
  const corrections: string[] = [];

  page.on("request", (request) => {
    if (/payment-intents|\/embed\/pay(?:ment)?/i.test(request.url())) paymentRequests += 1;
  });

  await page.addInitScript(() => {
    class FakeDataChannel extends EventTarget {
      readyState: RTCDataChannelState = "connecting";
      readonly sent: string[] = [];
      send(data: string) { this.sent.push(String(data)); }
      close() { this.readyState = "closed"; this.dispatchEvent(new Event("close")); }
      open() { this.readyState = "open"; this.dispatchEvent(new Event("open")); }
      emit(data: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) })); }
    }

    class FakePeerConnection extends EventTarget {
      iceGatheringState: RTCIceGatheringState = "complete";
      connectionState: RTCPeerConnectionState = "connected";
      ontrack: ((event: RTCTrackEvent) => void) | null = null;
      private readonly channel = new FakeDataChannel();
      constructor() { super(); ((window as any).__zyonRealtimeChannels ??= []).push(this.channel); }
      addTrack() { return undefined as never; }
      createDataChannel() { return this.channel as unknown as RTCDataChannel; }
      async createOffer() { return { type: "offer" as RTCSdpType, sdp: "v=0\r\n" }; }
      async setLocalDescription() {}
      async setRemoteDescription() { this.channel.open(); }
      close() { this.connectionState = "closed"; this.dispatchEvent(new Event("connectionstatechange")); }
    }

    Object.defineProperty(window, "RTCPeerConnection", { configurable: true, value: FakePeerConnection });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
      configurable: true,
      value: async () => ({ getTracks: () => [] }),
    });
  });

  await page.route("**/embed/start", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      session_id: "chk_voice_payment",
      experience: {
        brand: { name: "Zyon Store", mode: "dark" },
        agent: { name: "Zyon IA" },
        items: [{ sku: "SERUM-01", name: "Sérum Capilar", variant: '["internal_variant",[]]', variant_label: "30 ml", unit_price: 129.9, quantity: 1 }],
        totals: { subtotal: 129.9, discount: 0, total: 129.9 },
        paymentMethods: { pix: true, boleto: false, card: true },
        rules: { voiceEnabled: true },
      },
    }),
  }));
  await page.route("**/embed/realtime/session", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ value: "ephemeral_voice_test_secret" }),
  }));
  await page.route("https://api.openai.com/v1/realtime/calls", (route) => {
    const cors = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-headers": "authorization, content-type",
    };
    if (route.request().method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: cors });
    }
    return route.fulfill({
      status: 200,
      headers: { ...cors, "content-type": "application/sdp" },
      body: "v=0\r\n",
    });
  });
  await page.route("**/embed/chat", async (route) => {
    const body = route.request().postDataJSON() as { user_message?: unknown };
    if (typeof body.user_message === "string" && /e-mail/.test(body.user_message)) {
      corrections.push(body.user_message);
      return route.fulfill({ json: {
        message: body.user_message.includes("right@example.test")
          ? "Enviei um novo código para right@example.test. Qual é o código?"
          : "Zion: Qual é o e-mail correto para este pedido?",
        stage: "data_collection", missing_fields: ["email"], blocks: [],
      } });
    }
    if (body.user_message === "Vamos prosseguir") checkoutAdvanceCalls += 1;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        message: "Frete confirmado. Vamos às opções de pagamento.",
        blocks: [],
        stage: "payment",
      }),
    });
  });
  await page.route("**/checkout-settings/widget-config**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ enabledTriggers: [], advancedRules: [] }),
  }));
  await page.route("**/embed/track", (route) => route.fulfill({ status: 200, body: "{}" }));

  await page.goto("/?embed=1&embedToken=tok_voice&merchantId=mrc_voice&cartRef=cart_voice&apiBaseUrl=http://127.0.0.1:5174", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /Come.*por voz/ }).click();
  await expect(page.locator('.checkout-cart__product-variant')).toHaveText('30 ml');
  await expect(page.getByText(/plano Growth/)).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__zyonRealtimeChannels?.length ?? 0)).toBe(1);

  const correctionEvent = {
    type: "response.output_item.done",
    item: { type: "function_call", name: "correct_customer_details", call_id: "call_correct_email", arguments: JSON.stringify({ buyer_message: "Meu e-mail está errado." }) },
  };
  await page.evaluate(event => {
    const channel = (window as any).__zyonRealtimeChannels[0];
    channel.emit(event);
    channel.emit(event);
  }, correctionEvent);
  await expect(page.getByText("Qual é o e-mail correto para este pedido?", { exact: true })).toBeVisible();
  await expect(page.getByText(/^Zion:/)).toHaveCount(0);
  await expect.poll(() => corrections.length).toBe(1);
  await expect.poll(() => page.evaluate(() => (window as any).__zyonRealtimeChannels[0].sent
    .some((raw: string) => raw.includes("function_call_output") && raw.includes("e-mail correto") && !raw.includes("Zion:")))).toBe(true);
  await page.evaluate(() => (window as any).__zyonRealtimeChannels[0].emit({
    type: "response.output_item.done",
    item: { type: "function_call", name: "correct_customer_details", call_id: "call_correct_email_value", arguments: JSON.stringify({ buyer_message: "Meu e-mail correto é right@example.test" }) },
  }));
  await expect(page.getByText("Enviei um novo código para right@example.test. Qual é o código?", { exact: true })).toBeVisible();
  expect(corrections).toEqual(["Meu e-mail está errado.", "Meu e-mail correto é right@example.test"]);

  // This is the client-side function-call event emitted by Realtime after the
  // buyer says "quero finalizar". It exercises the same handler as live voice.
  await page.evaluate(() => {
    const channel = (window as any).__zyonRealtimeChannels[0];
    channel.emit({
      type: "response.output_item.done",
      item: { type: "function_call", name: "begin_checkout", call_id: "call_finish", arguments: "{}" },
    });
  });

  await expect.poll(() => checkoutAdvanceCalls).toBe(1);
  await expect(page.getByText(/Como.*pagar/)).toBeVisible();
  await expect(page.getByText("Pix", { exact: true })).toBeVisible();
  await expect(page.getByText("Cartão de crédito", { exact: true })).toBeVisible();
  await expect.poll(() => paymentRequests).toBe(0);
  await expect.poll(() => page.evaluate(() => (window as any).__zyonRealtimeChannels[0].sent.some((event: string) => event.includes("function_call_output")))).toBe(true);

  // Permission failures must not look like a subscription upsell to a buyer,
  // and the same checkout must remain usable by typing without a reload.
  await page.getByRole('button', { name: 'Pausar compra por voz' }).click();
  await page.route('**/embed/realtime/session', route => route.fulfill({ status: 403, json: { message: 'embed_origin_not_allowed' } }));
  await page.getByRole('button', { name: 'Ativar compra por voz' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Não foi possível iniciar a voz nesta sessão' })).toBeVisible();
  await expect(page.getByText(/plano Growth/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Digitar mensagem', exact: true }).click();
  const composer = page.getByRole('textbox', { name: 'Mensagem', exact: true });
  await composer.fill('Vamos prosseguir');
  await composer.press('Enter');
  await expect.poll(() => checkoutAdvanceCalls).toBe(2);
  await expect(page.locator('.checkout-cart__product-variant')).toHaveText('30 ml');
  expect(paymentRequests).toBe(0);
});
