import React, { useEffect, useRef, useState } from "react";
import { Mail } from "lucide-react";
import { Button } from "./Button.js";

export interface OtpModalProps {
  open: boolean;
  title: string;
  description: React.ReactNode;
  maskedDestination: string;
  onConfirm: (code: string) => Promise<void> | void;
  onResend: () => Promise<void> | void;
  onCancel: () => void;
  busy?: boolean;
  errorMessage?: string | null;
}

const CODE_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * 6-digit OTP modal with auto-focus, paste handling, single-input UX,
 * and a 60s cooldown on the resend button.
 */
export function OtpModal({
  open,
  title,
  description,
  maskedDestination,
  onConfirm,
  onResend,
  onCancel,
  busy,
  errorMessage,
}: OtpModalProps) {
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(""));
  const [resendCooldown, setResendCooldown] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setDigits(Array(CODE_LENGTH).fill(""));
      setResendCooldown(0);
      return;
    }
    // Auto-focus + start cooldown each time the modal opens.
    setTimeout(() => inputRef.current?.focus(), 50);
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
  }, [open]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => Math.max(s - 1, 0)), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  if (!open) return null;

  const code = digits.join("");
  const isComplete = code.length === CODE_LENGTH && digits.every((d) => d !== "");

  function setDigit(index: number, value: string) {
    const cleaned = value.replace(/\D/g, "");
    if (!cleaned) {
      setDigits((prev) => {
        const next = [...prev];
        next[index] = "";
        return next;
      });
      return;
    }
    if (cleaned.length === 1) {
      setDigits((prev) => {
        const next = [...prev];
        next[index] = cleaned;
        return next;
      });
      // Auto-advance focus to next input.
      if (index < CODE_LENGTH - 1) {
        const next = document.getElementById(`otp-digit-${index + 1}`);
        (next as HTMLInputElement | null)?.focus();
      }
      return;
    }
    // Handle paste of full string.
    const chars = cleaned.slice(0, CODE_LENGTH).split("");
    setDigits((prev) => {
      const next = [...prev];
      for (let i = 0; i < CODE_LENGTH; i++) {
        next[i] = chars[i] ?? "";
      }
      return next;
    });
    const lastIdx = Math.min(chars.length, CODE_LENGTH) - 1;
    const next = document.getElementById(`otp-digit-${lastIdx}`);
    (next as HTMLInputElement | null)?.focus();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      const prev = document.getElementById(`otp-digit-${index - 1}`);
      (prev as HTMLInputElement | null)?.focus();
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isComplete || busy) return;
    await onConfirm(code);
  }

  async function handleResend() {
    if (resendCooldown > 0) return;
    setResendCooldown(RESEND_COOLDOWN_SECONDS);
    setDigits(Array(CODE_LENGTH).fill(""));
    await onResend();
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="otp-modal-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.6)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
      onClick={onCancel}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--color-surface)",
          borderRadius: 12,
          padding: 28,
          width: "min(420px, 92vw)",
          display: "flex",
          flexDirection: "column",
          gap: 16,
          border: "1px solid var(--color-border)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Mail size={20} color="var(--color-primary)" />
          <h2 id="otp-modal-title" style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        </div>

        <p style={{ margin: 0, fontSize: 14, color: "var(--color-muted)", lineHeight: 1.5 }}>
          {description}
        </p>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{maskedDestination}</p>

        <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
          {digits.map((d, i) => (
            <input
              key={i}
              id={`otp-digit-${i}`}
              ref={i === 0 ? inputRef : undefined}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={CODE_LENGTH}
              value={d}
              disabled={busy}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              aria-label={`Dígito ${i + 1}`}
              style={{
                width: 44,
                height: 52,
                textAlign: "center",
                fontSize: 22,
                fontWeight: 600,
                borderRadius: 8,
                border: `1px solid ${errorMessage ? "var(--color-error)" : "var(--color-border)"}`,
                background: "var(--color-bg)",
                color: "var(--color-text)",
                fontFamily: "monospace",
              }}
            />
          ))}
        </div>

        {errorMessage && (
          <p style={{ margin: 0, color: "var(--color-error)", fontSize: 13 }}>{errorMessage}</p>
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <button
            type="button"
            onClick={() => void handleResend()}
            disabled={resendCooldown > 0 || busy}
            style={{
              background: "none",
              border: "none",
              color: resendCooldown > 0 ? "var(--color-muted)" : "var(--color-primary)",
              cursor: resendCooldown > 0 ? "default" : "pointer",
              fontSize: 13,
              padding: 0,
            }}
          >
            {resendCooldown > 0 ? `Reenviar em ${resendCooldown}s` : "Reenviar código"}
          </button>

          <div style={{ display: "flex", gap: 8 }}>
            <Button variant="ghost" size="sm" type="button" onClick={onCancel} disabled={busy}>
              Cancelar
            </Button>
            <Button
              variant="primary"
              size="sm"
              type="submit"
              disabled={!isComplete || busy}
              loading={busy}
            >
              Confirmar
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
