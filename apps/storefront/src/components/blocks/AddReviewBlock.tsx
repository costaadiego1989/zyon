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

export default function AddReviewBlock({
  block,
  onQuickReply,
}: AddReviewBlockProps) {
  const { data } = block;
  const [rating, setRating] = useState(0);
  const [text, setText] = useState("");

  const canSubmit = rating > 0 && text.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onQuickReply?.(
      `Avaliar ${data.productName} ${rating} estrelas: ${text.trim()}`
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
      </div>
    </article>
  );
}
