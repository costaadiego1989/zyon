import { useEffect, useRef, useState } from "react";

/**
 * Cloudflare Turnstile widget. Mounts an invisible (managed) challenge when a
 * site key is configured; emits the resulting token via onChange. When the
 * site key is missing the component renders nothing AND keeps `configured`
 * false — the form layer must treat that as "captcha disabled" and only
 * send the request when `configured === true` (production) or skip the
 * token field when not configured (dev).
 *
 * The widget is intentionally rendered with `appearance: "managed"` (a small
 * visible badge) so the buyer is aware the form is bot-protected even when
 * the challenge itself is invisible.
 */
export interface TurnstileProps {
  siteKey: string | undefined;
  onChange: (token: string | null) => void;
  onExpire?: () => void;
  // Optional explicit className so we can style within auth-form.
  className?: string;
}

declare global {
  // Cloudflare loads this global on script load. We type it narrowly so TS
  // doesn't complain when the script is absent (dev without a site key).
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback"?: () => void;
          "error-callback"?: () => void;
          appearance?: "always" | "execute" | "managed";
          theme?: "light" | "dark" | "auto";
          size?: "normal" | "flexible" | "compact";
        }
      ) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

export function Turnstile(props: TurnstileProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [configured, setConfigured] = useState<boolean>(Boolean(props.siteKey));

  useEffect(() => {
    const siteKey = props.siteKey;
    if (!siteKey) {
      setConfigured(false);
      return;
    }

    let cancelled = false;
    const tryRender = () => {
      if (cancelled) return;
      if (!window.turnstile || !containerRef.current) {
        // Script may not have loaded yet — wait for it.
        setTimeout(tryRender, 100);
        return;
      }
      // Avoid double-render if React StrictMode mounts twice in dev.
      if (widgetIdRef.current) return;
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token) => props.onChange(token),
        "expired-callback": () => {
          props.onChange(null);
          props.onExpire?.();
        },
        "error-callback": () => props.onChange(null),
        appearance: "managed",
        theme: "auto",
        size: "normal",
      });
    };
    tryRender();

    return () => {
      cancelled = true;
      if (widgetIdRef.current && window.turnstile) {
        try {
          window.turnstile.remove(widgetIdRef.current);
        } catch {
          // ignore — widget already gone
        }
        widgetIdRef.current = null;
      }
    };
    // We intentionally only depend on siteKey; callbacks are stable in practice
    // because the parent always uses the latest handler via closure refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.siteKey]);

  if (!props.siteKey) return null;
  return (
    <div
      ref={containerRef}
      className={props.className ?? "cf-turnstile"}
      data-testid="cf-turnstile"
      aria-hidden={!configured}
    />
  );
}
