"use client";

import { useRef, useCallback, type KeyboardEvent, type ClipboardEvent } from "react";

interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  length?: number;
  disabled?: boolean;
  autoFocus?: boolean;
  label?: string;
}

export function OtpInput({ value, onChange, length = 6, disabled, autoFocus, label }: OtpInputProps) {
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const focusInput = (index: number) => {
    if (index >= 0 && index < length) {
      inputsRef.current[index]?.focus();
      inputsRef.current[index]?.select();
    }
  };

  const handleChange = useCallback((index: number, digit: string) => {
    const sanitized = digit.replace(/\D/g, "").slice(0, 1);
    const chars = value.padEnd(length, " ").split("");
    chars[index] = sanitized;
    const newValue = chars.join("").replace(/ /g, "").slice(0, length);
    onChange(newValue);
    if (sanitized && index < length - 1) {
      focusInput(index + 1);
    }
  }, [value, length, onChange]);

  const handleKeyDown = useCallback((index: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const chars = value.padEnd(length, " ").split("");
      if (chars[index] !== " ") {
        chars[index] = " ";
        onChange(chars.join("").replace(/ /g, ""));
      } else if (index > 0) {
        chars[index - 1] = " ";
        onChange(chars.join("").replace(/ /g, ""));
        focusInput(index - 1);
      }
    } else if (e.key === "ArrowLeft") {
      focusInput(index - 1);
    } else if (e.key === "ArrowRight") {
      focusInput(index + 1);
    }
  }, [value, length, onChange]);

  const handlePaste = useCallback((e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData("text").replace(/\D/g, "").slice(0, length);
    onChange(pasted);
    focusInput(Math.min(pasted.length, length - 1));
  }, [length, onChange]);

  return (
    <div role="group" aria-label={label ?? "Código de verificação"} style={{ display: "flex", gap: "8px", justifyContent: "center" }}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          ref={(el) => { inputsRef.current[i] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[i] ?? ""}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          aria-label={`Dígito ${i + 1}`}
          style={{
            width: "44px",
            height: "52px",
            textAlign: "center",
            fontSize: "20px",
            fontWeight: 700,
            fontFamily: "'Space Mono', monospace",
            letterSpacing: "0",
            color: "var(--aacp-fg, #f5f5f7)",
            background: "var(--aacp-surface-2, rgba(255,255,255,0.05))",
            border: value[i] ? "2px solid var(--aacp-accent, #0f766e)" : "1px solid var(--aacp-line, rgba(255,255,255,0.08))",
            borderRadius: "12px",
            outline: "none",
            transition: "border-color 0.15s, box-shadow 0.15s",
            caretColor: "var(--aacp-accent, #0f766e)",
          }}
          onFocusCapture={(e) => {
            (e.target as HTMLInputElement).style.borderColor = "var(--aacp-accent, #0f766e)";
            (e.target as HTMLInputElement).style.boxShadow = "0 0 0 3px color-mix(in srgb, var(--aacp-accent, #0f766e) 20%, transparent)";
          }}
          onBlurCapture={(e) => {
            const hasValue = Boolean(value[i]);
            (e.target as HTMLInputElement).style.borderColor = hasValue ? "var(--aacp-accent, #0f766e)" : "var(--aacp-line, rgba(255,255,255,0.08))";
            (e.target as HTMLInputElement).style.boxShadow = "none";
          }}
        />
      ))}
    </div>
  );
}
