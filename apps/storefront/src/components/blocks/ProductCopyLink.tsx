"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { FiCheck, FiLink } from "react-icons/fi";

async function fallbackCopy(value: string): Promise<boolean> {
  if (typeof document === "undefined") return false;
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  document.body.appendChild(input);
  input.select();
  const copied = document.execCommand("copy");
  input.remove();
  return copied;
}

export async function copyProductShareUrl(value: string): Promise<boolean> {
  if (!value) return false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Some embedded browsers reject clipboard permissions. Try the compatible
    // document fallback before reporting a failure to the buyer.
  }
  return fallbackCopy(value);
}

export function ProductCopyLink({
  url,
  style,
  className,
}: {
  url: string;
  style?: CSSProperties;
  className?: string;
}) {
  const [status, setStatus] = useState<"copied" | "error" | null>(null);
  const statusId = useId();
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => {
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
  }, []);

  const copy = async () => {
    if (resetTimer.current) window.clearTimeout(resetTimer.current);
    setStatus(await copyProductShareUrl(url) ? "copied" : "error");
    resetTimer.current = window.setTimeout(() => setStatus(null), 3000);
  };

  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button
        data-neu="control"
        type="button"
        className={className}
        onClick={() => { void copy(); }}
        aria-label="Copiar link do produto"
        aria-describedby={status ? statusId : undefined}
        disabled={!url}
        title="Copiar link do produto"
        style={style}
      >
        {status === "copied" ? <FiCheck aria-hidden="true" /> : <FiLink aria-hidden="true" />}
      </button>
      {status ? (
        <span
          id={statusId}
          role="status"
          aria-live="polite"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 5,
            minWidth: "max-content",
            padding: "8px 10px",
            border: "1px solid var(--aacp-line)",
            borderRadius: "var(--aacp-radius-sm, 8px)",
            background: "var(--aacp-surface)",
            color: "var(--aacp-fg)",
            boxShadow: "var(--aacp-neu-raised-sm)",
            fontSize: "12px",
            fontWeight: 600,
            whiteSpace: "nowrap",
          }}
        >
          {status === "copied" ? "Link copiado" : "Não foi possível copiar. Tente novamente."}
        </span>
      ) : null}
    </span>
  );
}
