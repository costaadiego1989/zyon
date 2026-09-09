"use client";

import { useState, useEffect } from "react";
import { FiChevronLeft, FiChevronRight, FiImage } from "react-icons/fi";
import { useGallerySwipe } from "./useGallerySwipe";
import styles from "./ImageSlideshow.module.css";

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

export default function ImageSlideshow({ images, alt = "", width = "100%", height = "100%", objectFit = "contain", borderRadius = "0", showDots = true, showArrows = true, autoPlay = false, autoPlayInterval = 5000 }: SlideShowProps) {
  const [current, setCurrent] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const count = images.length;
  const index = count ? current % count : 0;
  const move = (direction: number) => setCurrent((value) => (value + direction + count) % count);
  const swipe = useGallerySwipe(count > 1, move);
  useEffect(() => {
    if (!autoPlay || count < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setCurrent((value) => (value + 1) % count);
    }, Math.max(2000, autoPlayInterval));
    return () => window.clearInterval(timer);
  }, [autoPlay, autoPlayInterval, count]);
  if (!count) return null;
  return <div className={styles.gallery} style={{ width, height, borderRadius, touchAction: count > 1 ? "pan-y pinch-zoom" : "auto" }} {...swipe} role="group" aria-label={"Imagens de " + alt}>
    {!failed.has(images[index]) ? <img key={images[index]} className={styles.image} src={images[index]} alt={alt + (count > 1 ? " — foto " + (index + 1) + " de " + count : "")} loading="lazy" draggable={false} style={{ objectFit }} onError={() => setFailed((previous) => new Set(previous).add(images[index]))} /> : <div className={styles.fallback}><FiImage aria-hidden="true" /><span>Imagem indisponível</span></div>}
    {count > 1 && showArrows ? <>
      <button type="button" className={styles.arrow + " " + styles.previous} aria-label="Imagem anterior" onClick={(event) => { event.stopPropagation(); move(-1); }}><FiChevronLeft aria-hidden="true" /></button>
      <button type="button" className={styles.arrow + " " + styles.next} aria-label="Próxima imagem" onClick={(event) => { event.stopPropagation(); move(1); }}><FiChevronRight aria-hidden="true" /></button>
    </> : null}
    {count > 1 && showDots ? <div className={styles.dots} aria-label="Escolher imagem">{images.map((_, i) => <button key={i} type="button" aria-label={"Imagem " + (i + 1)} aria-pressed={i === index} onClick={(event) => { event.stopPropagation(); setCurrent(i); }}><span /></button>)}</div> : null}
  </div>;
}
