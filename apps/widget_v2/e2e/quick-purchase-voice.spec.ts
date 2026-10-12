import { expect, test, type Page } from "@playwright/test";

async function fakeMicrophone(page: Page) {
  await page.addInitScript(() => {
    (window as any).__voiceRequests = [];
    class Channel extends EventTarget {
      readyState = "connecting";
      sent: any[] = [];
      send(raw: string) { this.sent.push(JSON.parse(raw)); }
      close() { this.readyState = "closed"; this.dispatchEvent(new Event("close")); }
      open() { this.readyState = "open"; this.dispatchEvent(new Event("open")); }
      emit(data: unknown) { this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) })); }
    }
    class Peer extends EventTarget {
      iceGatheringState = "complete";
      connectionState = "connected";
      localDescription = { sdp: "v=0\r\n" };
      channel = new Channel();
      constructor() { super(); ((window as any).__voiceChannels ??= []).push(this.channel); }
      addTrack() {}
      createDataChannel() { return this.channel; }
      async createOffer() { return { type: "offer", sdp: "v=0\r\n" }; }
      async setLocalDescription() {}
      async setRemoteDescription() { this.channel.open(); }
      close() { this.connectionState = "closed"; }
    }
    Object.defineProperty(window, "RTCPeerConnection", { configurable: true, value: Peer });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async (constraints: unknown) => {
      (window as any).__voiceRequests.push(constraints); return { getTracks: () => [] };
    } });
  });
  await page.route("https://api.openai.com/v1/realtime/calls", route => route.fulfill({
    status: 200, body: "v=0\r\n", headers: { "content-type": "application/sdp", "access-control-allow-origin": "*",
      "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "authorization, content-type" },
  }));
}

for (const width of [390, 1280]) {
  test(`voice waits for quick-purchase preferences and edits pending payment at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await fakeMicrophone(page);
    const buyer = { fullName: "QA Buyer", email: "qa@example.test", phone: "11987654321", cpf: "52998224725",
      address: { zip: "01310100", street: "Paulista", number: "100", complement: "", city: "São Paulo", state: "SP" } };
    const experience = { brand: { name: "Athom QA", mode: "dark" }, buyer, agent: { name: "Zyon" },
      items: [{ sku: "SERUM", name: "Sérum de Barreira 50 ml", unit_price: 200, quantity: 1 }],
      totals: { subtotal: 200, discount: 0, service_fee: .99, total_to_pay: 220.99, total: 220 },
      shipping: { carrierKey: "pac", carrier: "Correios", method: "PAC", customerPrice: 20 },
      paymentMethods: { pix: true, card: true, boleto: false }, rules: { voiceEnabled: true } };
    let paymentCalls = 0, sessionCalls = 0, paymentReady = false;
    const edits: string[] = [];
    let release!: () => void;
    const paymentGate = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/embed/start", route => route.fulfill({ json: { session_id: "chk_voice_quick", experience } }));
    await page.route("**/embed/payment/intents", async route => {
      paymentCalls += 1; await paymentGate; paymentReady = true;
      await route.fulfill({ json: { id: "pix-quick", method: "pix", status: "requires_action", amountCents: 22099,
        buyerFacing: { qrCodeCopyPaste: "qa-pix-pending" }, experience } });
    });
    await page.route("**/embed/realtime/session", route => { sessionCalls += 1; return route.fulfill({ json: { value: "qa-ephemeral-secret" } }); });
    await page.route("**/embed/realtime/context", route => route.fulfill({ json: { instructions: paymentReady
      ? "ETAPA ATUAL: Seu pagamento já está disponível na tela. Não pergunte sobre frete."
      : "ETAPA ATUAL: Escolha a forma de pagamento exibida na tela." } }));
    await page.route("**/embed/checkout/edit", route => {
      edits.push(route.request().postDataJSON().section); paymentReady = false;
      return route.fulfill({ json: { experience, revision: 2 } });
    });
    await page.route("**/embed/chat", route => route.fulfill({ json: { message: "Escolha a forma de pagamento.", stage: "payment", experience,
      blocks: [{ type: "payment_methods", data: { methods: [{ key: "pix", label: "Pix" }, { key: "credito", label: "Cartão de crédito" }] } }] } }));
    await page.route("**/checkout-settings/widget-config**", route => route.fulfill({ json: { enabledTriggers: [], advancedRules: [] } }));
    await page.route("**/embed/track", route => route.fulfill({ json: {} }));
    await page.goto("/?embed=1&embedToken=qa&merchantId=qa&apiBaseUrl=http://127.0.0.1:5174");
    await expect(page.getByRole("button", { name: /^Por chat/ })).toBeVisible();
    await page.evaluate(async () => {
      const { useCheckoutStore } = await import("/src/store/checkout-store.ts");
      await useCheckoutStore.getState().init({ embedToken: "qa", merchantId: "qa", apiBaseUrl: "http://127.0.0.1:5174",
        initialChannel: "voice", oneBuyClickPreferences: { shippingPreference: "cheapest", paymentPreference: "pix" } });
    });
    await expect.poll(() => paymentCalls).toBe(1);
    expect(sessionCalls).toBe(0);
    expect(await page.evaluate(() => (window as any).__voiceRequests.length)).toBe(0);
    release();
    await expect.poll(() => sessionCalls).toBe(1);
    await expect.poll(() => page.evaluate(() => (window as any).__voiceChannels?.[0]?.sent.some((event: any) => event.type === "response.create"))).toBe(true);
    const initial = await page.evaluate(() => (window as any).__voiceChannels[0].sent);
    expect(initial[0].type).toBe("session.update");
    expect(initial[0].session.instructions).toContain("pagamento já está disponível");
    expect(await page.evaluate(() => (window as any).__voiceRequests[0])).toMatchObject({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: false } });
    await page.evaluate(() => {
      const channel = (window as any).__voiceChannels[0];
      channel.emit({ type: "response.done" });
      for (const [index, transcript] of ["", "[respiração]", "[ruído]"].entries()) channel.emit({
        type: "conversation.item.input_audio_transcription.completed", item_id: `noise-${index}`, transcript,
      });
    });
    await expect.poll(() => page.evaluate(() => (window as any).__voiceChannels[0].sent.filter((event: any) => event.type === "conversation.item.delete").length)).toBe(3);
    expect(await page.evaluate(() => (window as any).__voiceChannels[0].sent.filter((event: any) => event.type === "response.create").length)).toBe(1);
    await page.evaluate(() => {
      const channel = (window as any).__voiceChannels[0];
      channel.emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "buyer-edit", transcript: "Quero trocar para cartão" });
    });
    await expect.poll(() => page.evaluate(() => (window as any).__voiceChannels[0].sent.filter((event: any) => event.type === "response.create").length)).toBe(2);
    await page.evaluate(() => {
      const channel = (window as any).__voiceChannels[0];
      channel.emit({ type: "response.output_item.done", item: { type: "function_call", name: "handoff_to_commerce_agent",
        call_id: "change-payment", arguments: JSON.stringify({ buyer_message: "Quero trocar para cartão" }) } });
      channel.emit({ type: "response.done" });
    });
    await expect(page.getByRole("button", { name: "Cartão de crédito", exact: true })).toBeVisible();
    expect(edits).toEqual(["payment"]); expect(paymentCalls).toBe(1);
    await expect.poll(() => page.evaluate(() => (window as any).__voiceChannels[0].sent.some((event: any) => event.type === "function_call_output"
      || event.item?.type === "function_call_output"))).toBe(true);
    const updated = await page.evaluate(() => (window as any).__voiceChannels[0].sent.filter((event: any) => event.type === "session.update").at(-1));
    expect(updated.session.instructions).toContain("Escolha a forma de pagamento");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(false);
  });
}
