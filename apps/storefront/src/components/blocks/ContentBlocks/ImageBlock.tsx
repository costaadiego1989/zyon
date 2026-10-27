"use client";

import { useState } from "react";
import Image from "next/image";
import type { ImageBlockData } from "./types";

/**
 * Image block. Prefers next/image when width/height are provided; falls back to
 * a plain <img> for arbitrary external sources without known dimensions (this
 * keeps dynamic BlockMedia URLs renderable without forcing the dashboard to
 * always declare dimensions).
 *
 * `alt` is REQUIRED by the type — buyers must always get descriptive text.
 */
export default function ImageBlock({ block }: { block: ImageBlockData }) {
  const [errored, setErrored] = useState(false);
  const useNext = !errored && block.width !== undefined && block.height !== undefined;

  const figureStyle: React.CSSProperties = {
    margin: "12px 0",
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: "6px",
  };

  if (useNext) {
    return (
      <figure style={figureStyle}>
        <Image
          src={block.src}
          alt={block.alt}
          width={block.width!}
          height={block.height!}
          unoptimized
          onError={() => setErrored(true)}
          style={{
            width: "100%",
            height: "auto",
            borderRadius: "var(--aacp-radius-sm)",
            display: "block",
          }}
        />
        {block.caption && (
          <figcaption
            style={{
              fontSize: "12.5px",
              color: "var(--aacp-muted)",
              fontFamily: "var(--aacp-font)",
              textAlign: "center",
            }}
          >
            {block.caption}
          </figcaption>
        )}
      </figure>
    );
  }

  return (
    <figure style={figureStyle}>
      <img
        src={block.src}
        alt={block.alt}
        loading="lazy"
        onError={() => setErrored(true)}
        style={{
          width: "100%",
          height: "auto",
          borderRadius: "var(--aacp-radius-sm)",
          display: "block",
        }}
      />
      {block.caption && (
        <figcaption
          style={{
            fontSize: "12.5px",
            color: "var(--aacp-muted)",
            fontFamily: "var(--aacp-font)",
            textAlign: "center",
          }}
        >
          {block.caption}
        </figcaption>
      )}
    </figure>
  );
}
