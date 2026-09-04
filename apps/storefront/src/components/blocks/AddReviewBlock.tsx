"use client";

import { useState } from "react";

interface AddReviewBlockProps {
  block: {
    type: "add_review";
    data: { productId: string; productName: string };
  };
  onQuickReply?: (text: string) => void;
}

function StarSelector({
  value,
  onChange,
}: {
  value: number;
  onChange: (rating: number) => void;
}) {
  const [hovered, setHovered] = useState(0);

  return (
    <div
      style={{
        display: "flex",
        gap: "4px",
        cursor: "pointer",
      }}
      role="radiogroup"
      aria-label="Selecione uma nota"
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const active = star <= (hovered || value);
        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={star === value}
            aria-label={`${star} estrela${star > 1 ? "s" : ""}`}
            onClick={() => onChange(star)}
            onMouseEnter={() => setHovered(star)}
            onMouseLeave={() => setHovered(0)}
            style={{
              width: "36px",
              height: "36px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "22px",
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
              color: active ? "#f59e0b" : "rgba(245, 158, 11, 0.25)",
              transition: "transform 0.12s ease, color 0.12s ease",
              transform: active ? "scale(1.15)" : "scale(1)",
            }}
          >
            ★
          </button>
        );
      })}
    </div>
  );
}

type Step = "identify" | "review";

export default function AddReviewBlock({
  block,
  onQuickReply,
}: AddReviewBlockProps) {
  const { data } = block;
  const [step, setStep] = useState<Step>("identify");
  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");

  const formatPhone = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 11);
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  };

  const isValidPhone = (value: string) => {
    const digits = value.replace(/\D/g, "");
    return digits.length === 10 || digits.length === 11;
  };

  const handleIdentifySubmit = () => {
    if (!isValidPhone(phone)) {
      setPhoneError("Informe um telefone válido com DDD");
      return;
    }
    if (!name.trim()) {
      setPhoneError("Informe seu nome");
      return;
    }
    setPhoneError("");
    setStep("review");
  };

  const canSubmit = rating > 0 && text.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    const phoneDigits = phone.replace(/\D/g, "");
    onQuickReply?.(
      `Avaliar ${data.productName} ${rating} estrelas: ${text.trim()} [nome:${name.trim()}|tel:${phoneDigits}]`
    );
  };

  return (
    <article
      style={{
        background: "var(--aacp-surface)",
        border: "1px solid var(--aacp-line)",
        borderRadius: "14px",
        overflow: "hidden",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 12px 32px rgba(0,0,0,0.10)",
        display: "flex",
        flexDirection: "column",
        width: "100%",
        fontFamily: "var(--aacp-font)",
        color: "var(--aacp-fg)",
        animation: "fadeSlideIn 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
      }}
    >
      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div
        style={{
          padding: "18px 18px 20px",
          display: "flex",
          flexDirection: "column",
          gap: "16px",
        }}
      >
        {/* Title */}
        <h3
          style={{
            margin: 0,
            fontSize: "16px",
            fontWeight: 700,
            fontFamily: "var(--aacp-font-display)",
            color: "var(--aacp-fg)",
            letterSpacing: "-0.01em",
          }}
        >
          Avaliar {data.productName}
        </h3>

        {step === "identify" && (
          <>
            <p
              style={{
                margin: 0,
                fontSize: "12px",
                color: "var(--aacp-muted)",
                lineHeight: 1.4,
              }}
            >
              Para registrar sua avaliação, precisamos identificar você.
            </p>

            {/* Name input */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "var(--aacp-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Seu nome
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Como quer ser identificado"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  border: "1px solid var(--aacp-line)",
                  background: "var(--aacp-surface-2)",
                  color: "var(--aacp-fg)",
                  fontSize: "13px",
                  fontFamily: "inherit",
                  outline: "none",
                  transition: "border-color 0.15s ease",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--aacp-accent)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--aacp-line)";
                }}
              />
            </div>

            {/* Phone input */}
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "var(--aacp-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Telefone (com DDD)
              </span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => {
                  setPhone(formatPhone(e.target.value));
                  setPhoneError("");
                }}
                placeholder="(11) 99999-9999"
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  border: `1px solid ${phoneError ? "#ef4444" : "var(--aacp-line)"}`,
                  background: "var(--aacp-surface-2)",
                  color: "var(--aacp-fg)",
                  fontSize: "13px",
                  fontFamily: "inherit",
                  outline: "none",
                  transition: "border-color 0.15s ease",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = phoneError ? "#ef4444" : "var(--aacp-accent)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = phoneError ? "#ef4444" : "var(--aacp-line)";
                }}
              />
              {phoneError && (
                <span style={{ fontSize: "11px", color: "#ef4444", marginTop: "2px" }}>
                  {phoneError}
                </span>
              )}
            </div>

            {/* Continue button */}
            <button
              type="button"
              onClick={handleIdentifySubmit}
              disabled={!name.trim() || !phone}
              style={{
                width: "100%",
                height: "44px",
                padding: "0 16px",
                borderRadius: "10px",
                border: "none",
                background:
                  name.trim() && phone
                    ? "var(--aacp-accent)"
                    : "color-mix(in srgb, var(--aacp-muted) 30%, var(--aacp-surface-2))",
                color: "#fff",
                fontSize: "14px",
                fontWeight: 700,
                fontFamily: "inherit",
                letterSpacing: "0.01em",
                cursor: name.trim() && phone ? "pointer" : "not-allowed",
                opacity: name.trim() && phone ? 1 : 0.6,
                transition:
                  "transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease",
                boxShadow:
                  name.trim() && phone
                    ? "0 4px 14px color-mix(in srgb, var(--aacp-accent) 30%, transparent)"
                    : "none",
              }}
            >
              Continuar
            </button>
          </>
        )}

        {step === "review" && (
          <>
            <p
              style={{
                margin: 0,
                fontSize: "12px",
                color: "var(--aacp-muted)",
                lineHeight: 1.4,
              }}
            >
              Avaliando como <strong style={{ color: "var(--aacp-fg)" }}>{name}</strong>
            </p>

            {/* Star selector */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "var(--aacp-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Sua nota
              </span>
              <StarSelector value={rating} onChange={setRating} />
            </div>

            {/* Text area */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "6px",
              }}
            >
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  color: "var(--aacp-muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                Comentário
              </span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Conte sua experiência..."
                rows={3}
                style={{
                  width: "100%",
                  padding: "12px 14px",
                  borderRadius: "10px",
                  border: "1px solid var(--aacp-line)",
                  background: "var(--aacp-surface-2)",
                  color: "var(--aacp-fg)",
                  fontSize: "13px",
                  fontFamily: "inherit",
                  lineHeight: 1.5,
                  resize: "vertical",
                  outline: "none",
                  transition: "border-color 0.15s ease",
                  boxSizing: "border-box",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--aacp-accent)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--aacp-line)";
                }}
              />
            </div>

            {/* Submit */}
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                width: "100%",
                height: "44px",
                padding: "0 16px",
                borderRadius: "10px",
                border: "none",
                background: canSubmit
                  ? "var(--aacp-accent)"
                  : "color-mix(in srgb, var(--aacp-muted) 30%, var(--aacp-surface-2))",
                color: "#fff",
                fontSize: "14px",
                fontWeight: 700,
                fontFamily: "inherit",
                letterSpacing: "0.01em",
                cursor: canSubmit ? "pointer" : "not-allowed",
                opacity: canSubmit ? 1 : 0.6,
                transition:
                  "transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease",
                boxShadow: canSubmit
                  ? "0 4px 14px color-mix(in srgb, var(--aacp-accent) 30%, transparent)"
                  : "none",
              }}
              onMouseEnter={(e) => {
                if (canSubmit) {
                  e.currentTarget.style.transform = "translateY(-1px)";
                  e.currentTarget.style.boxShadow =
                    "0 8px 22px color-mix(in srgb, var(--aacp-accent) 42%, transparent)";
                  e.currentTarget.style.filter = "brightness(1.05)";
                }
              }}
              onMouseLeave={(e) => {
                if (canSubmit) {
                  e.currentTarget.style.transform = "none";
                  e.currentTarget.style.boxShadow =
                    "0 4px 14px color-mix(in srgb, var(--aacp-accent) 30%, transparent)";
                  e.currentTarget.style.filter = "none";
                }
              }}
            >
              Enviar avaliação
            </button>
          </>
        )}
      </div>
    </article>
  );
}
