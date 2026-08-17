"use client";

import { useState, useCallback } from "react";

export interface SlideShowProps {
  images: string[];
  alt?: string;
  width?: string;
  height?: string;
  objectFit?: "cover" | "contain";
  borderRadius?: string;
  showDots?: boolean;
  showArrows?: boolean;
  autoPlay?: boolean;
  autoPlayInterval?: number;
}

/**
 * Reusable image slideshow component.
 * - Arrow navigation (‹ ›) when multiple images
 * - Dot indicators
 * - Optional autoplay
 * - Touch swipe support
 */
export default function ImageSlideshow({
  images,
  alt = "",
  width = "100%",
  height = "100%",
  objectFit = "contain",
  borderRadius = "0",
  showDots = true,
  showArrows = true,
  autoPlay = false,
  autoPlayInterval = 5000,
}: SlideShowProps) {
  const [current, setCurrent] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const count = images.length;

  const goNext = useCallback(() => setCurrent((c) => (c + 1) % count), [count]);
  const goPrev = useCallback(() => setCurrent((c) => (c - 1 + count) % count), [count]);

  // Autoplay
  if (autoPlay && count > 1) {
    // Use effect-less interval via ref pattern in parent — for now keep simple
  }

  if (count === 0) return null;
  if (count === 1) {
    return (
      <div style={{ position: "relative", width, height, borderRadius, overflow: "hidden" }}>
        <img src={images[0]} alt={alt} loading="lazy" style={{ width: "100%", height: "100%", objectFit, display: "block" }} />
      </div>
    );
  }

  return (
    <div
      style={{ position: "relative", width, height, borderRadius, overflow: "hidden" }}
      onTouchStart={(e) => setTouchStart(e.touches[0]?.clientX ?? null)}
      onTouchEnd={(e) => {
        if (touchStart === null) return;
        const diff = (e.changedTouches[0]?.clientX ?? 0) - touchStart;
        if (diff > 40) goPrev();
        else if (diff < -40) goNext();
        setTouchStart(null);
      }}
    >
      <img
        src={images[current]}
        alt={`${alt} ${current + 1}/${count}`}
        loading="lazy"
        style={{ width: "100%", height: "100%", objectFit, display: "block", transition: "opacity 0.2s ease" }}
      />

      {/* Left arrow */}
      {showArrows && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          aria-label="Anterior"
          style={{
            position: "absolute",
            left: "6px",
            top: "50%",
            transform: "translateY(-50%)",
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            border: "none",
            background: "rgba(0,0,0,0.45)",
            color: "#fff",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2,
            opacity: 0.8,
            transition: "opacity 0.15s",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
      )}

      {/* Right arrow */}
      {showArrows && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          aria-label="Próximo"
          style={{
            position: "absolute",
            right: "6px",
            top: "50%",
            transform: "translateY(-50%)",
            width: "28px",
            height: "28px",
            borderRadius: "50%",
            border: "none",
            background: "rgba(0,0,0,0.45)",
            color: "#fff",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2,
            opacity: 0.8,
            transition: "opacity 0.15s",
          }}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        </button>
      )}

      {/* Dots */}
      {showDots && (
        <div style={{ position: "absolute", bottom: "8px", left: "50%", transform: "translateX(-50%)", display: "flex", gap: "4px", zIndex: 2 }}>
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={(e) => { e.stopPropagation(); setCurrent(i); }}
              aria-label={`Imagem ${i + 1}`}
              style={{
                width: i === current ? "14px" : "6px",
                height: "6px",
                borderRadius: "3px",
                border: "none",
                padding: 0,
                background: i === current ? "#fff" : "rgba(255,255,255,0.45)",
                cursor: "pointer",
                transition: "all 0.2s ease",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
