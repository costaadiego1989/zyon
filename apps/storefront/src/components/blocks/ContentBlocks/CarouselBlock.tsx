"use client";

import { useCallback, useState } from "react";
import type { CarouselBlockData } from "./types";

/**
 * Simple image carousel: native horizontal scroll with snap on mobile, plus
 * prev/next + dots on wider viewports. No external dependency; works even if
 * ImageSlideshow assumptions (single hero) don't fit a content-document layout.
 */
export default function CarouselBlock({ block }: { block: CarouselBlockData }) {
  const [current, setCurrent] = useState(0);
  const count = block.images.length;
  const goNext = useCallback(
    () => setCurrent((c) => (count === 0 ? 0 : (c + 1) % count)),
    [count],
  );
  const goPrev = useCallback(
    () => setCurrent((c) => (count === 0 ? 0 : (c - 1 + count) % count)),
    [count],
  );

  if (count === 0) return null;

  const arrowStyle: React.CSSProperties = {
    position: "absolute",
    top: "50%",
    transform: "translateY(-50%)",
    width: "32px",
    height: "32px",
    borderRadius: "50%",
    border: "none",
    background: "rgba(0,0,0,0.5)",
    color: "#fff",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  };

  return (
    <figure
      role="group"
      aria-label="Galeria de imagens"
      style={{
        margin: "14px 0",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
      }}
    >
      <div
        style={{
          position: "relative",
          width: "100%",
          borderRadius: "var(--aacp-radius-md)",
          overflow: "hidden",
          background: "var(--aacp-surface-2)",
        }}
      >
        <div
          style={{
            display: "flex",
            overflowX: "auto",
            scrollSnapType: "x mandatory",
            scrollBehavior: "smooth",
            scrollbarWidth: "none",
          }}
        >
          {block.images.map((img, i) => (
            <img
              key={i}
              src={img.src}
              alt={img.alt}
              loading="lazy"
              style={{
                flex: "0 0 100%",
                width: "100%",
                height: "auto",
                maxHeight: "70vh",
                objectFit: "cover",
                scrollSnapAlign: "start",
                display: "block",
              }}
              onLoad={() => setCurrent((c) => (i === c ? c : c))}
            />
          ))}
        </div>

        {count > 1 && (
          <>
            <button
              type="button"
              aria-label="Imagem anterior"
              onClick={goPrev}
              style={{ ...arrowStyle, left: "8px" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M15 18l-6-6 6-6" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Proxima imagem"
              onClick={goNext}
              style={{ ...arrowStyle, right: "8px" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M9 18l6-6-6-6" />
              </svg>
            </button>
            <div
              role="tablist"
              aria-label="Selecionar imagem"
              style={{
                position: "absolute",
                bottom: "8px",
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                gap: "6px",
                zIndex: 2,
              }}
            >
              {block.images.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === current}
                  aria-label={`Imagem ${i + 1}`}
                  onClick={() => setCurrent(i)}
                  style={{
                    width: i === current ? "16px" : "8px",
                    height: "8px",
                    borderRadius: "999px",
                    border: "none",
                    padding: 0,
                    background: i === current ? "#fff" : "rgba(255,255,255,0.5)",
                    cursor: "pointer",
                    transition: "width 0.2s ease, background 0.2s ease",
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>
      {block.caption && (
        <figcaption
          style={{
            fontSize: "12.5px",
            color: "var(--aacp-muted)",
            textAlign: "center",
          }}
        >
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}
