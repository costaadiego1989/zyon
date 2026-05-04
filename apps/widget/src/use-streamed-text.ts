import { useEffect, useRef, useState } from "react";

export interface StreamedTextOptions {
  enabled?: boolean;
  charDurationMs?: number;
}

const DEFAULT_DURATION_MS = 22;

function disableStreamingByEnv(): boolean {
  try {
    const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
      .process?.env;
    if (env?.AACP_DISABLE_STREAMING === "1") return true;
  } catch {
    // ignore — env not accessible in browser bundles
  }
  return false;
}

function reducedMotionPreferred(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function useStreamedText(
  text: string,
  options: StreamedTextOptions = {}
): { displayed: string; isStreaming: boolean } {
  const { enabled = true, charDurationMs = DEFAULT_DURATION_MS } = options;
  const [displayed, setDisplayed] = useState<string>(() =>
    enabled && !reducedMotionPreferred() && !disableStreamingByEnv() ? "" : text
  );
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled || reducedMotionPreferred() || disableStreamingByEnv()) {
      setDisplayed(text);
      return;
    }
    setDisplayed("");
    let index = 0;
    intervalRef.current = window.setInterval(() => {
      index += 1;
      if (index >= text.length) {
        setDisplayed(text);
        if (intervalRef.current !== null) {
          window.clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
        return;
      }
      setDisplayed(text.slice(0, index));
    }, charDurationMs);
    return () => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [text, enabled, charDurationMs]);

  return { displayed, isStreaming: displayed.length < text.length };
}
