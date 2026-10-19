import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { chromium } from "playwright";

// Opt-in, provider-backed deployment probe. No login, order or payment is made.
// Only sanitized transport evidence is printed; tokens and SDP stay in memory.
const url = process.env.ZYON_VOICE_URL;
assert(url, "Set ZYON_VOICE_URL to the deployed Growth storefront.");
const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const origin = new URL(url).origin;
const results = { sessions: [], narration: [], directProviderRequests: 0, pageErrors: [] };
if (process.env.ZYON_VERCEL_BYPASS) {
  await context.route(`${origin}/**`, route => route.continue({ headers: {
    ...route.request().headers(), "x-vercel-protection-bypass": process.env.ZYON_VERCEL_BYPASS,
  } }));
}
page.on("pageerror", error => results.pageErrors.push(error.message.slice(0, 160)));
page.on("request", request => {
  if (new URL(request.url()).hostname === "api.openai.com") results.directProviderRequests++;
});
page.on("response", async response => {
  const pathname = new URL(response.url()).pathname;
  if (!/\/realtime\/(session|narration)$/.test(pathname)) return;
  const request = response.request().postDataJSON();
  const body = await response.json().catch(() => ({}));
  const code = body.code ?? body.error ?? body.message;
  const evidence = { status: response.status(), offer: request?.sdp?.startsWith("v=0\r\n") === true,
    answer: body.sdp?.startsWith("v=0") === true,
    ...(typeof code === "string" && /^[a-z_]{1,80}$/.test(code) ? { code } : {}) };
  results[pathname.endsWith("narration") ? "narration" : "sessions"].push(evidence);
});
await page.addInitScript(() => {
  const probe = window.__voiceProbe = { peers: [], channels: [], inbound: [], microphoneCalls: 0, tracks: [], nativeSpeech: 0, narration: [] };
  const NativePeer = window.RTCPeerConnection;
  window.RTCPeerConnection = class extends NativePeer {
    constructor(...args) { super(...args); probe.peers.push(this); }
    createDataChannel(...args) {
      const channel = super.createDataChannel(...args); probe.channels.push(channel);
      channel.addEventListener("message", event => {
        try { probe.inbound.push(JSON.parse(event.data)); } catch { /* Non-JSON protocol event. */ }
      });
      return channel;
    }
  };
  Object.defineProperty(navigator.mediaDevices, "getUserMedia", { configurable: true, value: async () => {
    probe.microphoneCalls++;
    const audio = new AudioContext();
    const destination = audio.createMediaStreamDestination();
    const silence = audio.createConstantSource(); silence.offset.value = 0;
    silence.connect(destination); silence.start(); await audio.resume();
    probe.tracks.push(...destination.stream.getTracks());
    probe.speak = async encoded => {
      await audio.resume();
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      const source = audio.createBufferSource(); source.buffer = await audio.decodeAudioData(bytes.buffer);
      source.connect(destination); source.start();
    };
    return destination.stream;
  } });
  if (window.speechSynthesis) window.speechSynthesis.speak = () => { probe.nativeSpeech++; };
  window.addEventListener("zyon:realtime-product-narration-progress", event => probe.narration.push(event.detail));
});
const until = async (predicate, message, timeout = 30_000) => {
  const expires = Date.now() + timeout;
  while (Date.now() < expires) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const state = await page.evaluate(() => ({
    peers: window.__voiceProbe.peers.map(peer => peer.connectionState),
    events: window.__voiceProbe.inbound.map(event => event.type),
    errors: window.__voiceProbe.inbound.filter(event => event.type === "error").map(event => event.error?.code),
  }));
  throw new Error(`${message}: ${JSON.stringify({ ...results, state })}`);
};
try {
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  assert.equal(response.status(), 200, "Storefront must load successfully");
  if (process.env.ZYON_VOICE_INSPECT === "1") {
    await page.waitForTimeout(2500);
    console.log(JSON.stringify({ title: await page.title(), buttons: await page.getByRole("button").allTextContents(),
      text: (await page.locator("body").innerText()).slice(0, 2400) }));
  } else {
    const declineCookies = page.getByRole("button", { name: "Não aceito", exact: true });
    await declineCookies.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    if (await declineCookies.isVisible()) await declineCookies.click();
    const chat = page.getByRole("button", { name: /^Por chat/ });
    if (await chat.isVisible()) await chat.click();
    const activate = page.getByRole("button", { name: "Ativar compra por voz", exact: true });
    await activate.waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(1000);
    assert.equal(results.sessions.length, 0, "Page load must not start purchase voice");
    assert.equal(await page.evaluate(() => window.__voiceProbe.microphoneCalls), 0);
    await activate.click();
    await until(() => results.sessions.length > 0, "No session response");
    assert(results.sessions[0].status < 300 && results.sessions[0].offer && results.sessions[0].answer, JSON.stringify(results));
    await until(() => page.evaluate(() => window.__voiceProbe.channels[0]?.readyState === "open"), "Data channel did not open");
    await until(() => page.evaluate(() => window.__voiceProbe.inbound.some(event => event.type === "response.done")), "No provider response");
    await until(() => page.evaluate(() => [...document.querySelectorAll("audio[data-zyon-realtime-audio]")]
      .some(audio => audio.srcObject && !audio.paused && audio.currentTime > 0)), "Remote audio did not play");
    if (process.env.ZYON_VOICE_WAV) {
      const encoded = (await readFile(process.env.ZYON_VOICE_WAV)).toString("base64");
      await page.evaluate(value => window.__voiceProbe.speak(value), encoded);
      await until(() => page.evaluate(() => window.__voiceProbe.inbound.some(event =>
        event.type === "conversation.item.input_audio_transcription.completed" && /ol[aá]|ajud|ouvi/i.test(event.transcript ?? ""))), "Spoken audio was not transcribed");
      await until(() => page.evaluate(() => window.__voiceProbe.inbound.filter(event => event.type === "response.done").length >= 2), "No response to spoken input");
    }
    const transport = await page.evaluate(async () => {
      const probe = window.__voiceProbe;
      let audioBytes = 0;
      for (const peer of probe.peers) for (const stat of (await peer.getStats()).values()) {
        if (stat.type === "inbound-rtp" && stat.kind === "audio") audioBytes += stat.bytesReceived ?? 0;
      }
      return { connected: probe.peers.some(peer => peer.connectionState === "connected"), audioBytes,
        transcriptions: probe.inbound.filter(event => event.type === "conversation.item.input_audio_transcription.completed").length,
        providerErrors: probe.inbound.filter(event => event.type === "error").map(event => event.error?.code ?? "unknown") };
    });
    assert(transport.connected && transport.audioBytes > 0, "No inbound provider audio");
    assert.deepEqual(transport.providerErrors, []);
    await page.getByRole("button", { name: "Desativar compra por voz", exact: true }).click();
    await until(() => page.evaluate(() => window.__voiceProbe.tracks.every(track => track.readyState === "ended")), "Microphone was not released");
    if (process.env.ZYON_VOICE_SKIP_NARRATION !== "1") {
      const microphones = await page.evaluate(() => window.__voiceProbe.microphoneCalls);
      await page.evaluate(() => window.dispatchEvent(new CustomEvent("zyon:realtime-product-summary", {
        detail: { requestId: "deployment-smoke", summary: "Este produto possui diferentes opções. Confira os detalhes e escolha a opção desejada." },
      })));
      await until(() => results.narration.length > 0, "No narration response");
      assert(results.narration[0].status < 300 && results.narration[0].offer && results.narration[0].answer, JSON.stringify(results));
      await until(() => page.evaluate(() => window.__voiceProbe.narration.some(event => event.transcript?.length > 10)), "No narration transcript");
      assert.equal(await page.evaluate(() => window.__voiceProbe.microphoneCalls), microphones, "Summary must not use microphone");
      assert.equal(await page.getByRole("button", { name: "Desativar compra por voz", exact: true }).count(), 0, "Summary enabled purchase mode");
    }
    assert.equal(results.directProviderRequests, 0);
    assert.equal(await page.evaluate(() => window.__voiceProbe.nativeSpeech), 0);
    assert.deepEqual(results.pageErrors, []);
    console.log(JSON.stringify({ result: "PASS", origin, ...results, transport }));
  }
} finally {
  await context.close(); await browser.close();
}
