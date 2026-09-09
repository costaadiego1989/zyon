export interface EmbeddedSignupSettings { configured: boolean; appId: string; configId: string }
export interface EmbeddedSignupResult { wabaId: string; phoneNumberId: string }
interface FacebookSdk {
  init(options: { appId: string; version: string; cookie: boolean; xfbml: boolean }): void;
  login(callback: (response: { authResponse?: { code?: string }; status?: string }) => void, options: {
    config_id: string; auth_type: string; response_type: string; override_default_response_type: boolean;
  }): void;
}
declare global { interface Window { FB: FacebookSdk; fbAsyncInit: () => void } }

let sdkPromise: Promise<void> | undefined;
export function loadFacebookSdk(appId: string): Promise<void> {
  const init = () => window.FB.init({ appId, version: "v21.0", cookie: true, xfbml: false });
  if (window.FB) { init(); return Promise.resolve(); }
  if (!sdkPromise) sdkPromise = new Promise<void>((resolve, reject) => {
    let script = document.getElementById("zyon-facebook-sdk") as HTMLScriptElement | null;
    const timeout = window.setTimeout(() => {
      sdkPromise = undefined;
      script?.remove();
      reject(new Error("Não foi possível carregar a conexão com a Meta. Verifique se o navegador bloqueou o Facebook e recarregue a página."));
    }, 20_000);
    window.fbAsyncInit = () => { window.clearTimeout(timeout); init(); resolve(); };
    if (!script) {
      script = document.createElement("script");
      script.id = "zyon-facebook-sdk";
      script.src = "https://connect.facebook.net/pt_BR/sdk.js";
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
      script.onerror = () => { window.clearTimeout(timeout); sdkPromise = undefined; script?.remove(); reject(new Error("Não foi possível carregar a conexão com a Meta. Recarregue a página para tentar novamente.")); };
      document.body.appendChild(script);
    }
  });
  return sdkPromise;
}

export function parseEmbeddedSignupEvent(event: Pick<MessageEvent, "origin" | "data">):
  { type: "finish"; result: EmbeddedSignupResult } | { type: "cancel" | "error" } | null {
  let origin: URL;
  try { origin = new URL(event.origin); } catch { return null; }
  if (origin.protocol !== "https:" || origin.port
    || !(origin.hostname === "facebook.com" || origin.hostname.endsWith(".facebook.com"))) return null;
  try {
    const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
    if (data?.type !== "WA_EMBEDDED_SIGNUP") return null;
    if (data.event === "CANCEL") return { type: "cancel" };
    if (data.event === "ERROR") return { type: "error" };
    if (data.event === "FINISH" && typeof data.data?.waba_id === "string" && /^\d{5,40}$/.test(data.data.waba_id)
      && typeof data.data?.phone_number_id === "string" && /^\d{5,40}$/.test(data.data.phone_number_id)) {
      return { type: "finish", result: { wabaId: data.data.waba_id, phoneNumberId: data.data.phone_number_id } };
    }
  } catch { /* Non-JSON messages from the SDK are unrelated. */ }
  return null;
}

/** Install before FB.login: FINISH may arrive before the login callback. */
export function launchEmbeddedSignup(settings: EmbeddedSignupSettings, signal: AbortSignal): Promise<EmbeddedSignupResult & { code: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let code: string | undefined;
    let result: EmbeddedSignupResult | undefined;
    const complete = () => {
      if (!settled && code && result) { settled = true; cleanup(); resolve({ ...result, code }); }
    };
    const cleanup = () => { window.removeEventListener("message", receive); signal.removeEventListener("abort", abort); window.clearTimeout(timer); };
    const fail = (message: string) => { if (settled) return; settled = true; cleanup(); reject(new Error(message)); };
    const abort = () => fail("Conexão cancelada.");
    const receive = (event: MessageEvent) => {
      const parsed = parseEmbeddedSignupEvent(event);
      if (!parsed || settled) return;
      if (parsed.type === "finish") { result = parsed.result; complete(); }
      else fail(parsed.type === "cancel" ? "Você cancelou a autorização. Seus dados foram preservados." : "A Meta não concluiu a autorização. Confira a conta Business e tente novamente.");
    };
    const timer = window.setTimeout(() => fail("A autorização não foi concluída. Permita pop-ups e tente novamente quando estiver com o número disponível."), 600_000);
    if (signal.aborted) { abort(); return; }
    window.addEventListener("message", receive);
    signal.addEventListener("abort", abort, { once: true });
    try {
      window.FB.login(response => {
        if (typeof response.authResponse?.code === "string" && response.authResponse.code) {
          code = response.authResponse.code;
          complete();
        } else fail("A autorização não foi concluída. Tente novamente quando estiver com o número disponível.");
      }, {
        config_id: settings.configId, auth_type: "rerequest", response_type: "code", override_default_response_type: true,
      });
    } catch { fail("Não foi possível abrir a autorização. Permita pop-ups do dashboard e tente novamente."); }
  });
}
