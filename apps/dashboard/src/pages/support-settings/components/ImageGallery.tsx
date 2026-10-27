import React, { useState } from "react";
import { Lightbox } from "./Lightbox.js";

interface ImageGalleryProps {
  images: string[];
}

export function ImageGallery({ images }: ImageGalleryProps) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (!images.length) return null;

  const maxPerRow = 4;
  const gap = 8;

  return (
    <>
      <div
        className="image-gallery"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(auto-fill, minmax(80px, 1fr))`,
          gap: `${gap}px`,
          marginTop: 12,
        }}
      >
        {images.map((url, idx) => (
          <button
            key={idx}
            type="button"
            className="image-gallery-thumbnail"
            onClick={() => setLightboxIndex(idx)}
            aria-label={`Ver imagem ${idx + 1}`}
            style={{
              aspectRatio: "1",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius-sm)",
              padding: 0,
              background: "var(--color-surface-raised)",
              cursor: "pointer",
              overflow: "hidden",
            }}
          >
            <img
              src={url}
              alt={`Miniatura ${idx + 1}`}
              loading="lazy"
              style={{
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          </button>
        ))}
      </div>

      {lightboxIndex !== null && (
        <Lightbox
          images={images}
          index={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}
