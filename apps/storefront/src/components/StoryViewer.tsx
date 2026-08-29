"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StoryCategory } from "./StoriesRow";

const FONT_MAP: Record<string, string> = {
  inter: "'Inter', sans-serif",
  playfair: "'Playfair Display', serif",
  "space-mono": "'Space Mono', monospace",
  "dm-sans": "'DM Sans', sans-serif",
  "bebas-neue": "'Bebas Neue', sans-serif",
  montserrat: "'Montserrat', sans-serif",
  oswald: "'Oswald', sans-serif",
  poppins: "'Poppins', sans-serif",
  raleway: "'Raleway', sans-serif",
  "roboto-condensed": "'Roboto Condensed', sans-serif",
  lora: "'Lora', serif",
  "abril-fatface": "'Abril Fatface', serif",
};

const GOOGLE_FONTS_URL = "https://fonts.googleapis.com/css2?family=Inter:wght@600;700&family=Playfair+Display:wght@700&family=Space+Mono:wght@700&family=DM+Sans:wght@700&family=Bebas+Neue&family=Montserrat:wght@700&family=Oswald:wght@700&family=Poppins:wght@700&family=Raleway:wght@700&family=Roboto+Condensed:wght@700&family=Lora:wght@700&family=Abril+Fatface&display=swap";

interface StoryViewerProps {
  categories: StoryCategory[];
  initialCategoryIndex: number;
  onClose: () => void;
  onViewed: (categoryId: string) => void;
}

export default function StoryViewer({
  categories,
  initialCategoryIndex,
  onClose,
  onViewed,
}: StoryViewerProps) {
  const [catIndex, setCatIndex] = useState(initialCategoryIndex);
  const [storyIndex, setStoryIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);

  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);
  const elapsedRef = useRef(0);
  const longPressRef = useRef<number | null>(null);
  const touchStartRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const viewedCatsRef = useRef<Set<string>>(new Set());

  const currentCategory = categories[catIndex];
  const currentStory = currentCategory?.stories[storyIndex];
  const duration = (currentStory?.duration ?? 7) * 1000;

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const markViewed = useCallback((idx: number) => {
    const cat = categories[idx];
    if (cat && !viewedCatsRef.current.has(cat.id)) {
      viewedCatsRef.current.add(cat.id);
      onViewed(cat.id);
    }
  }, [categories, onViewed]);

  const goNext = useCallback(() => {
    const cat = categories[catIndex];
    if (storyIndex < cat.stories.length - 1) {
      setStoryIndex((s) => s + 1);
      setProgress(0);
      setImageLoaded(false);
      elapsedRef.current = 0;
    } else {
      markViewed(catIndex);
      if (catIndex < categories.length - 1) {
        setCatIndex((c) => c + 1);
        setStoryIndex(0);
        setProgress(0);
        setImageLoaded(false);
        elapsedRef.current = 0;
      } else {
        markViewed(catIndex);
        onClose();
      }
    }
  }, [catIndex, storyIndex, categories, markViewed, onClose]);

  const goPrev = useCallback(() => {
    if (storyIndex > 0) {
      setStoryIndex((s) => s - 1);
      setProgress(0);
      setImageLoaded(false);
      elapsedRef.current = 0;
    } else if (catIndex > 0) {
      const prevCat = categories[catIndex - 1];
      setCatIndex((c) => c - 1);
      setStoryIndex(prevCat.stories.length - 1);
      setProgress(0);
      setImageLoaded(false);
      elapsedRef.current = 0;
    } else {
      setProgress(0);
      elapsedRef.current = 0;
    }
  }, [catIndex, storyIndex, categories]);

  useEffect(() => {
    if (paused || !imageLoaded) return;

    startTimeRef.current = performance.now() - elapsedRef.current;

    function tick() {
      const now = performance.now();
      const elapsed = now - startTimeRef.current;
      elapsedRef.current = elapsed;
      const pct = Math.min(elapsed / duration, 1);
      setProgress(pct);

      if (pct >= 1) {
        goNext();
        return;
      }
      timerRef.current = requestAnimationFrame(tick);
    }

    timerRef.current = requestAnimationFrame(tick);

    return () => {
      if (timerRef.current !== null) {
        cancelAnimationFrame(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [catIndex, storyIndex, paused, imageLoaded, duration, goNext]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") goNext();
      if (e.key === "ArrowLeft") goPrev();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, goNext, goPrev]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY, time: Date.now() };
    longPressRef.current = window.setTimeout(() => {
      setPaused(true);
    }, 200);
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (longPressRef.current !== null) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }

    if (paused) {
      setPaused(false);
      return;
    }

    const start = touchStartRef.current;
    if (!start) return;

    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const elapsed = Date.now() - start.time;

    if (elapsed < 400) {
      if (Math.abs(dy) > 80 && Math.abs(dy) > Math.abs(dx)) {
        if (dy > 0) { onClose(); return; }
      }
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0) {
          markViewed(catIndex);
          if (catIndex < categories.length - 1) {
            setCatIndex((c) => c + 1);
            setStoryIndex(0);
            setProgress(0);
            setImageLoaded(false);
            elapsedRef.current = 0;
          } else {
            onClose();
          }
          return;
        }
        if (dx > 0 && catIndex > 0) {
          setCatIndex((c) => c - 1);
          setStoryIndex(0);
          setProgress(0);
          setImageLoaded(false);
          elapsedRef.current = 0;
          return;
        }
      }
    }

    if (Math.abs(dx) < 10 && Math.abs(dy) < 10) {
      const width = window.innerWidth;
      if (touch.clientX > width * 0.5) {
        goNext();
      } else {
        goPrev();
      }
    }
  }, [paused, catIndex, categories, goNext, goPrev, markViewed, onClose]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x > rect.width * 0.5) {
      goNext();
    } else {
      goPrev();
    }
  }, [goNext, goPrev]);

  const mouseDownRef = useRef<number | null>(null);

  const handleMouseDown = useCallback(() => {
    mouseDownRef.current = window.setTimeout(() => {
      setPaused(true);
    }, 200);
  }, []);

  const handleMouseUp = useCallback(() => {
    if (mouseDownRef.current !== null) {
      clearTimeout(mouseDownRef.current);
      mouseDownRef.current = null;
    }
    if (paused) {
      setPaused(false);
    }
  }, [paused]);

  function getTitleStyle(): React.CSSProperties {
    const config = currentStory?.titleConfig as any;
    if (!config) return { display: "none" };

    const base: React.CSSProperties = {
      position: "absolute",
      textAlign: "center",
      fontSize: `${config.fontSize ?? 18}px`,
      fontWeight: 700,
      color: config.color || "#fff",
      fontFamily: FONT_MAP[config.font] || config.font || "inherit",
      padding: "8px 12px",
      borderRadius: "8px",
      zIndex: 3,
      maxWidth: "85%",
    };

    if (config.hasBg) {
      base.background = config.bgColor
        ? `${config.bgColor}${Math.round((config.bgOpacity ?? 0.5) * 255).toString(16).padStart(2, "0")}`
        : `rgba(0,0,0,${config.bgOpacity ?? 0.5})`;
    }

    if (config.positionX != null && config.positionY != null) {
      base.left = `${config.positionX}%`;
      base.top = `${config.positionY}%`;
      base.transform = "translate(-50%, -50%)";
    } else {
      base.left = "16px";
      base.right = "16px";
      switch (config.position) {
        case "top":
          base.top = "56px";
          break;
        case "bottom":
          base.bottom = "40px";
          break;
        default:
          base.top = "50%";
          base.transform = "translateY(-50%)";
      }
    }

    return base;
  }

  if (!currentCategory || !currentStory) return null;

  const overlay = (
    <>
    {/* eslint-disable-next-line @next/next/no-page-custom-font */}
    <link rel="stylesheet" href={GOOGLE_FONTS_URL} />
    <div
      role="dialog"
      aria-label="Visualizador de stories"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        background: "#000",
        opacity: visible ? 1 : 0,
        transition: "opacity 200ms ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        userSelect: "none",
      }}
    >
      {/* Content container — 9:16 aspect, max 1080×1920, centered */}
      <div style={{ position: "relative", width: "100%", maxWidth: "540px", height: "100%", maxHeight: "960px", display: "flex", flexDirection: "column" }}>
      <div
        style={{
          position: "absolute",
          top: "12px",
          left: "12px",
          right: "12px",
          display: "flex",
          gap: "3px",
          zIndex: 10,
        }}
      >
        {currentCategory.stories.map((_, idx) => {
          let fill = 0;
          if (idx < storyIndex) fill = 1;
          else if (idx === storyIndex) fill = progress;
          return (
            <div
              key={idx}
              style={{
                flex: 1,
                height: "3px",
                borderRadius: "2px",
                background: "rgba(255,255,255,0.3)",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${fill * 100}%`,
                  height: "100%",
                  background: "#fff",
                  borderRadius: "2px",
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Close button */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        aria-label="Fechar stories"
        style={{
          position: "absolute",
          top: "16px",
          right: "16px",
          width: "32px",
          height: "32px",
          borderRadius: "50%",
          border: "none",
          background: "rgba(0,0,0,0.4)",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 10,
          padding: 0,
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#fff"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Story image area */}
      <div
        style={{
          flex: 1,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
        onClick={handleClick}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
      >
        <img
          key={`${catIndex}-${storyIndex}`}
          src={currentStory.imageUrl}
          alt={currentStory.title || `Story ${storyIndex + 1}`}
          onLoad={() => setImageLoaded(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "contain",
            opacity: imageLoaded ? 1 : 0,
            transition: "opacity 150ms ease",
          }}
        />

        {/* Navigation arrows */}
        {(storyIndex > 0 || catIndex > 0) && (
          <button type="button" onClick={(e) => { e.stopPropagation(); goPrev(); }} aria-label="Anterior" style={{ position: "absolute", left: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.4)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 5, opacity: 0.7, transition: "opacity 0.15s" }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
        )}
        <button type="button" onClick={(e) => { e.stopPropagation(); goNext(); }} aria-label="Próximo" style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", width: "36px", height: "36px", borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.4)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 5, opacity: 0.7, transition: "opacity 0.15s" }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
        </button>

        {/* Title overlay */}
        {currentStory.title && (
          <div style={getTitleStyle()}>
            {currentStory.title}
          </div>
        )}
      </div>
      </div>{/* close content container */}
    </div>
    </>
  );

  if (typeof document === "undefined") return null;
  return overlay;
}
