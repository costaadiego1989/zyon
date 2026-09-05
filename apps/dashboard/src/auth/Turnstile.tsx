import { useEffect, useRef, useState } from "react";

export interface TurnstileProps {
  siteKey: string | undefined;
  onChange: (token: string | null) => void;
  onExpire?: () => void;
  className?: string;
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: {
        sitekey: string;
        callback: (token: string) => void;
        "expired-callback": () => void;
        "error-callback": (code: string) => boolean;
        "timeout-callback": () => void;
        "unsupported-callback": () => void;
        appearance: "always";
        theme: "dark";
        size: "flexible";
        language: "pt-br";
      }) => string;
      remove: (widgetId: string) => void;
    };
  }
}

let scriptLoading: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  if (scriptLoading) return scriptLoading;
  scriptLoading = new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    const timer = window.setTimeout(fail, 15000);
    function fail() {
      window.clearTimeout(timer);
      script.onload = null;
      script.onerror = null;
      script.remove();
      reject(new Error("turnstile_script_unavailable"));
    }
    script.onerror = fail;
    script.onload = () => {
      if (!window.turnstile) { fail(); return; }
      window.clearTimeout(timer);
      resolve();
    };
    document.head.appendChild(script);
  }).catch(error => { scriptLoading = null; throw error; });
  return scriptLoading;
}

/** Keep verification required, while giving failed challenges a way to recover. */
export function Turnstile(props: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"loading" | "verifying" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!props.siteKey) return;
    let cancelled = false;
    let widgetId: string | undefined;
    let verificationTimer: number | undefined;
    callbacks.current.onChange(null);
    setStatus("loading");
    setMessage("");
    const fail = (text: string) => {
      if (cancelled) return;
      window.clearTimeout(verificationTimer);
      callbacks.current.onChange(null);
      setStatus("error");
      setMessage(text);
    };
    void loadTurnstile().then(() => {
      if (cancelled || !containerRef.current || !window.turnstile) return;
      setStatus("verifying");
      verificationTimer = window.setTimeout(() => fail("A verificação está demorando. Tente novamente ou use outro navegador."), 30000);
      widgetId = window.turnstile.render(containerRef.current, {
        sitekey: props.siteKey!,
        callback: token => {
          if (cancelled) return;
          window.clearTimeout(verificationTimer);
          callbacks.current.onChange(token);
          setStatus("ready");
          setMessage("");
        },
        "expired-callback": () => {
          fail("A verificação expirou. Verifique novamente para continuar.");
          if (!cancelled) callbacks.current.onExpire?.();
        },
        "error-callback": () => { fail("Não foi possível verificar seu navegador. Tente novamente ou use outro navegador."); return true; },
        "timeout-callback": () => fail("O tempo da verificação acabou. Tente novamente."),
        "unsupported-callback": () => fail("Este navegador não é compatível com a verificação. Abra o cadastro em outro navegador."),
        appearance: "always",
        theme: "dark",
        size: "flexible",
        language: "pt-br",
      });
    }).catch(() => fail("Não foi possível carregar a verificação. Confira sua conexão e tente novamente."));

    return () => {
      cancelled = true;
      window.clearTimeout(verificationTimer);
      if (widgetId && window.turnstile) {
        try { window.turnstile.remove(widgetId); } catch { /* Widget already removed. */ }
      }
      callbacks.current.onChange(null);
    };
  }, [props.siteKey, attempt]);

  if (!props.siteKey) return null;
  return (
    <div className={props.className ?? "auth-verification"}>
      <div ref={containerRef} data-testid="cf-turnstile" />
      <p className="auth-verification__status" role="status" aria-live="polite">
        {status === "loading" ? "Carregando verificação de segurança…" : status === "verifying" ? "Conclua a verificação de segurança para continuar." : status === "ready" ? "Verificação concluída." : message}
      </p>
      {status === "error" && <button type="button" className="auth-btn-secondary" onClick={() => setAttempt(value => value + 1)}>Tentar verificação novamente</button>}
    </div>
  );
}
