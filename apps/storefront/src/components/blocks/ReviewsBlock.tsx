"use client";

import { useState } from "react";

interface ReviewData {
  id: string;
  author: string;
  rating: number;
  text: string;
  date: string;
}

interface ReviewsBlockProps {
  block: {
    type: "reviews";
    data: {
      productId: string;
      productName: string;
      averageRating: number;
      totalReviews: number;
      reviews: ReviewData[];
      nextCursor?: string;
    };
  };
  onQuickReply?: (text: string) => void;
}

function StarRow({ rating, size = 14 }: { rating: number; size?: number }) {
  const full = Math.floor(rating);
  const partial = Math.max(0, Math.min(1, rating - full));
  return (
    <span
      style={{
        display: "inline-flex",
        gap: "1px",
        fontSize: `${size}px`,
        lineHeight: 1,
      }}
      aria-label={`${rating.toFixed(1)} de 5 estrelas`}
    >
      {Array.from({ length: 5 }).map((_, i) => {
        let fill = 0;
        if (i < full) fill = 1;
        else if (i === full) fill = partial;
        return (
          <span key={i} style={{ position: "relative", display: "inline-block" }}>
            <span style={{ color: "rgba(245, 158, 11, 0.22)" }}>★</span>
            {fill > 0 && (
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  width: `${fill * 100}%`,
                  overflow: "hidden",
                  color: "#f59e0b",
                  whiteSpace: "nowrap",
                }}
              >
                ★
              </span>
            )}
          </span>
        );
      })}
    </span>
  );
}

function DistributionBar({
  star,
  percent,
}: {
  star: number;
  percent: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        fontSize: "11px",
        color: "var(--aacp-muted)",
      }}
    >
      <span style={{ width: "18px", textAlign: "right", fontWeight: 600 }}>
        {star}★
      </span>
      <div
        style={{
          flex: 1,
          height: "6px",
          borderRadius: "3px",
          background: "var(--aacp-surface-2)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: "100%",
            height: "100%",
            borderRadius: "3px",
            background: `color-mix(in srgb, var(--aacp-accent) ${Math.max(40, percent)}%, transparent)`,
            transformOrigin: "left",
            transform: `scaleX(${percent / 100})`,
            transition: "transform 0.3s ease",
          }}
        />
      </div>
      <span style={{ width: "32px", fontSize: "10px", fontWeight: 500 }}>
        {percent}%
      </span>
    </div>
  );
}

function getInitial(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.charAt(0).toUpperCase();
}

export default function ReviewsBlock({ block, onQuickReply }: ReviewsBlockProps) {
  const { data } = block;
  const [visibleCount, setVisibleCount] = useState(5);

  const visibleReviews = data.reviews.slice(0, visibleCount);
  const hasMore = visibleCount < data.reviews.length || !!data.nextCursor;

  // Compute distribution (approximate from available reviews)
  const distribution = [5, 4, 3, 2, 1].map((star) => {
    const count = data.reviews.filter((r) => Math.round(r.rating) === star).length;
    const percent =
      data.reviews.length > 0 ? Math.round((count / data.reviews.length) * 100) : 0;
    return { star, percent };
  });

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

      {/* Summary Header */}
      <div
        style={{
          padding: "18px 18px 14px",
          display: "flex",
          gap: "18px",
          alignItems: "flex-start",
          borderBottom: "1px solid var(--aacp-line)",
        }}
      >
        {/* Left: big average */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "6px",
            minWidth: "70px",
          }}
        >
          <span
            style={{
              fontSize: "28px",
              fontWeight: 800,
              color: "var(--aacp-fg)",
              fontFamily: "var(--aacp-font-display)",
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }}
          >
            {data.averageRating.toFixed(1)}
          </span>
          <StarRow rating={data.averageRating} size={15} />
          <span
            style={{
              fontSize: "11px",
              color: "var(--aacp-muted)",
              fontWeight: 500,
            }}
          >
            {data.totalReviews} avaliações
          </span>
        </div>

        {/* Right: distribution */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            justifyContent: "center",
          }}
        >
          {distribution.map((d) => (
            <DistributionBar key={d.star} star={d.star} percent={d.percent} />
          ))}
        </div>
      </div>

      {/* Reviews List */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
        }}
      >
        {visibleReviews.map((review, idx) => (
          <div
            key={review.id}
            style={{
              padding: "14px 18px",
              borderBottom:
                idx < visibleReviews.length - 1
                  ? "1px solid var(--aacp-line)"
                  : "none",
              display: "flex",
              gap: "12px",
              alignItems: "flex-start",
            }}
          >
            {/* Avatar */}
            <div
              style={{
                width: "32px",
                height: "32px",
                borderRadius: "50%",
                background:
                  "color-mix(in srgb, var(--aacp-accent) 15%, var(--aacp-surface-2))",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "13px",
                fontWeight: 700,
                color: "var(--aacp-accent)",
                flexShrink: 0,
              }}
            >
              {getInitial(review.author)}
            </div>

            {/* Content */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  marginBottom: "4px",
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    fontSize: "12.5px",
                    fontWeight: 700,
                    color: "var(--aacp-fg)",
                  }}
                >
                  {review.author}
                </span>
                <StarRow rating={review.rating} size={11} />
                <span
                  style={{
                    fontSize: "10.5px",
                    color: "var(--aacp-muted)",
                    marginLeft: "auto",
                  }}
                >
                  {review.date}
                </span>
              </div>
              <p
                style={{
                  margin: 0,
                  fontSize: "12px",
                  lineHeight: 1.5,
                  color: "var(--aacp-muted)",
                }}
              >
                {review.text}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Load more */}
      {hasMore && (
        <div
          style={{
            padding: "12px 18px",
            borderTop: "1px solid var(--aacp-line)",
            textAlign: "center",
          }}
        >
          <button
            type="button"
            onClick={() => setVisibleCount((c) => c + 5)}
            style={{
              padding: "8px 20px",
              borderRadius: "999px",
              border: "1px solid var(--aacp-line)",
              background: "var(--aacp-surface-2)",
              color: "var(--aacp-accent)",
              fontSize: "12px",
              fontWeight: 600,
              fontFamily: "inherit",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--aacp-accent)";
              e.currentTarget.style.background =
                "color-mix(in srgb, var(--aacp-accent) 8%, var(--aacp-surface))";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--aacp-line)";
              e.currentTarget.style.background = "var(--aacp-surface-2)";
            }}
          >
            Ver mais
          </button>
        </div>
      )}

      {/* Bottom quick reply */}
      <div
        style={{
          padding: "12px 18px 14px",
          borderTop: "1px solid var(--aacp-line)",
          background: "var(--aacp-surface-2)",
        }}
      >
        <button
          type="button"
          onClick={() =>
            onQuickReply?.(`Adicionar avaliação para ${data.productName}`)
          }
          style={{
            width: "100%",
            padding: "10px 16px",
            borderRadius: "10px",
            border: "1.5px solid var(--aacp-accent)",
            background: "transparent",
            color: "var(--aacp-accent)",
            fontSize: "13px",
            fontWeight: 700,
            fontFamily: "inherit",
            cursor: "pointer",
            transition: "all 0.15s ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background =
              "color-mix(in srgb, var(--aacp-accent) 10%, transparent)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          Adicionar avaliação para {data.productName}
        </button>
      </div>
    </article>
  );
}
