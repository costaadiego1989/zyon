import { useEffect, useRef, useState } from "react";

export interface StreamedTextOptions {
  enabled?: boolean;
  charDurationMs?: number;
  onComplete?: () => void;
  skipCompleteWhenDisabled?: boolean;
}

const DEFAULT_DURATION_MS = 22;

export function disableStreamingByEnv(): boolean {
  try {
    const env = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } })
      .process?.env;
    if (env?.AACP_DISABLE_STREAMING === "1") return true;
    if (env?.VITEST || env?.NODE_ENV === "test") return true;
  } catch {
    // ignore
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
  const { enabled = true, charDurationMs = DEFAULT_DURATION_MS, onComplete, skipCompleteWhenDisabled } = options;
  const [displayed, setDisplayed] = useState<string>(() =>
    enabled && !reducedMotionPreferred() && !disableStreamingByEnv() ? "" : text
  );
  const intervalRef = useRef<number | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  useEffect(() => {
    const disabledByEnv = disableStreamingByEnv();
    const treatAsStaticPlayback = !enabled || reducedMotionPreferred() || disabledByEnv;
    const skipStaticComplete =
      Boolean(skipCompleteWhenDisabled) &&
      (!reducedMotionPreferred() || !enabled) &&
      !disabledByEnv;
    if (treatAsStaticPlayback) {
      setDisplayed(text);
      if (!skipStaticComplete) queueMicrotask(() => onCompleteRef.current?.());
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
        onCompleteRef.current?.();
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
  }, [text, enabled, charDurationMs, skipCompleteWhenDisabled]);

  return { displayed, isStreaming: displayed.length < text.length };
}
