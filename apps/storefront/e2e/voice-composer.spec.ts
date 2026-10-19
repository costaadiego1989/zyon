import { expect, test, type Page } from "@playwright/test";

async function prepare(page: Page, theme = "light") {
  const calls = { sessions: 0, provider: 0 };
  page.on("pageerror", (error) => { throw error; });
  await page.addInitScript((value) => localStorage.setItem("zyon-theme", value), theme);
  await page.route("https://api.openai.com/**", async (route) => { calls.provider++; await route.abort(); });
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (!pathname.startsWith("/api/")) return route.continue();
    if (pathname.endsWith("/realtime/session")) { calls.sessions++; return route.fulfill({ status: 429, json: { error: "quota" } }); }
    if (pathname.endsWith("/conversations") || pathname.endsWith("/storefront-conversations")) return route.fulfill({ json: { conversation_id: "voice-conversation",
      conversation_token: `${Buffer.from(JSON.stringify({ origin: "http://127.0.0.1:5203", expiresAt: Date.now() / 1000 + 3600 })).toString("base64url")}.fixture` } });
    return route.fulfill({ json: { items: [], categories: [], enabled: false } });
  });
  return calls;
}
async function enterChat(page: Page, query = "") {
  await page.goto(`/${query}`);
  const entry = page.getByRole("button", { name: /Por chat/ });
  if (!query.includes("disabled")) { await expect(entry).toBeVisible(); await entry.click(); }
  await expect(page.getByRole("textbox", { name: "Mensagem", exact: true })).toBeVisible();
}

for (const width of [390, 1440]) for (const theme of ["light", "dark"]) {
  test(`microphone belongs to composer only at ${width}px ${theme}`, async ({ page }, info) => {
    const calls = await prepare(page, theme); await page.setViewportSize({ width, height: 900 });
    await enterChat(page);
    const mic = page.locator('[data-aacp-voice-channel="chat"]');
    await expect(mic).toHaveCount(1);
    await expect(page.locator('header [data-aacp-voice-channel]')).toHaveCount(0);
    await expect(page.locator('[data-aacp-composer-controls] [data-aacp-voice-channel]')).toHaveCount(1);
    await expect(mic).toHaveAttribute("aria-pressed", "false");
    const microphone = await mic.boundingBox();
    const input = await page.getByRole("textbox", { name: "Mensagem", exact: true }).boundingBox();
    expect(microphone!.x + microphone!.width).toBeLessThan(input!.x);
    expect(microphone!.width).toBeGreaterThanOrEqual(44); expect(microphone!.height).toBeGreaterThanOrEqual(44);
    const color = await mic.evaluate((element) => {
      const style = getComputedStyle(element);
      const probe = document.createElement("span"); probe.style.backgroundColor = "var(--aacp-accent)";
      element.append(probe); const accent = getComputedStyle(probe).backgroundColor; probe.remove();
      return { background: style.backgroundColor, accent, foreground: style.color };
    });
    expect(color.background).toBe(color.accent); expect(color.foreground).not.toBe(color.background);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(calls).toEqual({ sessions: 0, provider: 0 });
    await page.screenshot({ path: info.outputPath(`voice-composer-${width}-${theme}.png`) });
  });
}

test("denied microphone permission makes no provider call and can return to typing", async ({ page }) => {
  const calls = await prepare(page);
  await page.addInitScript(() => Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true,
    value: async () => { throw new DOMException("Denied for local test", "NotAllowedError"); } }));
  await enterChat(page);
  await page.locator('[data-aacp-voice-channel="chat"]').click();
  await expect(page.getByText("Permita o uso do microfone para iniciar a compra por voz.", { exact: true })).toBeVisible();
  await expect(page.locator('[data-aacp-voice-channel="voice"]')).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Desativar compra por voz", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Mensagem", exact: true })).toBeVisible();
  expect(calls).toEqual({ sessions: 0, provider: 0 });
  await expect(page.locator("audio[data-zyon-realtime-audio]")).toHaveCount(0);
});

test("voice unavailable for this store keeps text composer without a microphone entry", async ({ page }) => {
  const calls = await prepare(page); await enterChat(page, "?disabled=1");
  await expect(page.locator("[data-aacp-voice-channel]")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Mensagem", exact: true }).fill("Quero saber mais");
  await expect(page.locator("[data-aacp-composer-frame]").getByRole("button", { name: "Enviar mensagem", exact: true })).toBeEnabled();
  expect(calls).toEqual({ sessions: 0, provider: 0 });
});

async function fakeVoicePeer(page: Page) {
  await page.addInitScript(() => {
    const state = { microphones: 0, stopped: 0, offers: 0, answers: [] as string[], directions: [] as string[] };
    (window as any).__sdpContract = state;
    class Channel extends EventTarget {
      readyState = "connecting";
      send() {}
      close() { this.readyState = "closed"; this.dispatchEvent(new Event("close")); }
      open() { this.readyState = "open"; this.dispatchEvent(new Event("open")); }
    }
    class Peer extends EventTarget {
      iceGatheringState = "complete";
      connectionState = "connected";
      localDescription = { sdp: "v=0\na=sendrecv\n" };
      channel = new Channel();
      addTrack() {}
      addTransceiver(_kind: string, options: { direction: string }) { state.directions.push(options.direction); }
      createDataChannel() { return this.channel; }
      async createOffer() { state.offers++; return { type: "offer", sdp: this.localDescription.sdp }; }
      async setLocalDescription() {}
      async setRemoteDescription(answer: { sdp: string }) { state.answers.push(answer.sdp); this.channel.open(); }
      close() { this.connectionState = "closed"; }
    }
    Object.defineProperty(window, "RTCPeerConnection", { configurable: true, value: Peer });
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      state.microphones++;
      return { getTracks: () => [{ stop: () => { state.stopped++; } }] };
    } });
  });
}

test("storefront sends SDP only after activation and accepts the API answer", async ({ page }) => {
  const calls = await prepare(page);
  await fakeVoicePeer(page);
  const requests: unknown[] = [];
  await page.route("**/realtime/session", route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    return route.fulfill(body?.sdp === "v=0\r\na=sendrecv\r\n"
      ? { json: { sdp: "v=0\na=recvonly\n" } }
      : { status: 400, json: { code: "voice_sdp_offer_required" } });
  });
  await enterChat(page);
  expect(requests).toEqual([]);
  await page.locator('[data-aacp-voice-channel="chat"]').click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({ sdp: "v=0\r\na=sendrecv\r\n" });
  await expect.poll(() => page.evaluate(() => (window as any).__sdpContract.answers)).toEqual(["v=0\r\na=recvonly\r\n"]);
  expect(calls.provider).toBe(0);
  await page.getByRole("button", { name: "Desativar compra por voz", exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).__sdpContract.stopped)).toBe(1);
  await expect(page.locator("audio[data-zyon-realtime-audio]")).toHaveCount(0);
});

test("SDP rejection retains the API error code and releases the microphone", async ({ page }) => {
  await prepare(page);
  await fakeVoicePeer(page);
  await page.route("**/realtime/session", route => route.fulfill({ status: 400, json: { code: "voice_sdp_offer_required" } }));
  await enterChat(page);
  await page.locator('[data-aacp-voice-channel="chat"]').click();
  await expect(page.getByText(/Código: voice_sdp_offer_required/)).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__sdpContract.stopped)).toBe(1);
  await expect(page.locator("audio[data-zyon-realtime-audio]")).toHaveCount(0);
});

test("product narration sends summary and SDP without enabling purchase voice or microphone", async ({ page }) => {
  const calls = await prepare(page);
  await fakeVoicePeer(page);
  const requests: any[] = [];
  await page.route("**/realtime/narration", route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    return route.fulfill(body?.sdp && body?.summary
      ? { json: { sdp: "v=0\na=sendonly\n" } }
      : { status: 400, json: { code: "voice_sdp_offer_required" } });
  });
  await enterChat(page);
  expect(requests).toEqual([]);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent("zyon:realtime-product-summary", {
    detail: { summary: "Resumo do sérum capilar.", requestId: "summary-contract" },
  })));
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toEqual({ summary: "Resumo do sérum capilar.", sdp: "v=0\r\na=sendrecv\r\n" });
  await expect.poll(() => page.evaluate(() => (window as any).__sdpContract.answers)).toEqual(["v=0\r\na=sendonly\r\n"]);
  expect(await page.evaluate(() => (window as any).__sdpContract.microphones)).toBe(0);
  expect(await page.evaluate(() => (window as any).__sdpContract.directions)).toEqual(["recvonly"]);
  await expect(page.locator('[data-aacp-voice-channel="chat"]')).toHaveAttribute("aria-pressed", "false");
  expect(calls).toEqual({ sessions: 0, provider: 0 });
});

test("native browser WebRTC completes the API SDP exchange and opens its data channel", async ({ page }) => {
  const calls = await prepare(page);
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
      const context = new AudioContext();
      const destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator();
      oscillator.connect(destination); oscillator.start();
      return destination.stream;
    } });
  });
  let negotiations = 0;
  await page.route("**/realtime/session", async route => {
    const body = route.request().postDataJSON();
    expect(body.sdp).toMatch(/^v=0\r\n/);
    negotiations++;
    // A browser-local remote peer supplies a real, parseable SDP answer.
    // It tests the transport without contacting OpenAI or consuming credits.
    const answer = await page.evaluate(async offer => {
      const peer = new RTCPeerConnection();
      (window as any).__remoteVoicePeer = peer;
      (window as any).__remoteVoiceEvents = [];
      peer.ondatachannel = event => event.channel.onmessage = message => {
        (window as any).__remoteVoiceEvents.push(JSON.parse(message.data).type);
      };
      await peer.setRemoteDescription({ type: "offer", sdp: offer });
      const context = new AudioContext();
      const destination = context.createMediaStreamDestination();
      const oscillator = context.createOscillator();
      oscillator.connect(destination); oscillator.start();
      for (const track of destination.stream.getTracks()) peer.addTrack(track, destination.stream);
      await peer.setLocalDescription(await peer.createAnswer());
      if (peer.iceGatheringState !== "complete") await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 1500);
        peer.onicegatheringstatechange = () => {
          if (peer.iceGatheringState === "complete") { clearTimeout(timeout); resolve(); }
        };
      });
      return peer.localDescription!.sdp;
    }, body.sdp);
    await route.fulfill({ json: { sdp: answer } });
  });
  await enterChat(page);
  await page.locator('[data-aacp-voice-channel="chat"]').click();
  await expect.poll(() => page.evaluate(() => (window as any).__remoteVoiceEvents?.includes("conversation.item.create")), { timeout: 15000 }).toBe(true);
  expect(await page.evaluate(() => (window as any).__remoteVoiceEvents.includes("response.create"))).toBe(false);
  await expect.poll(() => page.locator("audio[data-zyon-realtime-audio]").evaluate((audio: HTMLAudioElement) => Boolean(audio.srcObject))).toBe(true);
  expect(negotiations).toBe(1);
  expect(calls.provider).toBe(0);
  await page.getByRole("button", { name: "Desativar compra por voz", exact: true }).click();
  await expect(page.locator("audio[data-zyon-realtime-audio]")).toHaveCount(0);
  await page.evaluate(() => (window as any).__remoteVoicePeer.close());
});
