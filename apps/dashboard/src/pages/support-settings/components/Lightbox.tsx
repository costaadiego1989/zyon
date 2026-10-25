import React, { useCallback, useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

interface LightboxProps {
  images: string[];
  index: number;
  onClose: () => void;
}

export function Lightbox({ images, index, onClose }: LightboxProps) {
  const [current, setCurrent] = useState(index);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setCurrent(index);
  }, [index]);

  const goPrev = useCallback(() => {
    setCurrent((c) => (c > 0 ? c - 1 : c));
  }, []);

  const goNext = useCallback(() => {
    setCurrent((c) => (c < images.length - 1 ? c + 1 : c));
  }, [images.length]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") goPrev();
      else if (e.key === "ArrowRight") goNext();
    }
    window.addEventListener("keydown", handleKeyDown);
    closeRef.current?.focus();
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, goPrev, goNext]);

  if (!images.length || current < 0 || current >= images.length) return null;

  const currentUrl = images[current];
  const hasMultiple = images.length > 1;

  return (
    <div
      className="lightbox-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Visualizador de imagens"
    >
      <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
        <button
          ref={closeRef}
          type="button"
          className="lightbox-close"
          onClick={onClose}
          aria-label="Fechar visualizador"
        >
          <X size={22} />
        </button>

        <img
          src={currentUrl}
          alt={`Imagem ${current + 1} de ${images.length}`}
          className="lightbox-image"
        />

        {hasMultiple && (
          <>
            <button
              type="button"
              className="lightbox-nav lightbox-nav--prev"
              onClick={goPrev}
              disabled={current === 0}
              aria-label="Imagem anterior"
            >
              <ChevronLeft size={30} />
            </button>
            <button
              type="button"
              className="lightbox-nav lightbox-nav--next"
              onClick={goNext}
              disabled={current === images.length - 1}
              aria-label="Próxima imagem"
            >
              <ChevronRight size={30} />
            </button>
            <div className="lightbox-counter">
              {current + 1} / {images.length}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
