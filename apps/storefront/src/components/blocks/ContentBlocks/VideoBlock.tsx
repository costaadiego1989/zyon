"use client";

import { useState } from "react";
import type { VideoBlockData } from "./types";

/**
 * Allowlist of trusted embed origins. Defense in depth — the dashboard should
 * already validate on save, but we re-check client-side to refuse anything not
 * in this list. Reject = render nothing (no placeholder).
 */
function isAllowedHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:";
  } catch {
    return false;
  }
}

function buildEmbedUrl(provider: VideoBlockData["provider"], ref: string): string | null {
  if (provider === "youtube") {
    // ref is the video id (e.g. dQw4w9WgXcQ).
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(ref)) return null;
    return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(ref)}`;
  }
  if (provider === "vimeo") {
    if (!/^\d{6,12}$/.test(ref)) return null;
    return `https://player.vimeo.com/video/${encodeURIComponent(ref)}`;
  }
  if (provider === "mp4") {
    return isAllowedHttpsUrl(ref) ? ref : null;
  }
  return null;
}

export default function VideoBlock({ block }: { block: VideoBlockData }) {
  const [error, setError] = useState(false);
  const [started, setStarted] = useState(false);
  const src = buildEmbedUrl(block.provider, block.ref);

  if (!src || error) return null;

  if (!started) {
    const poster = block.thumbnailUrl && isAllowedHttpsUrl(block.thumbnailUrl)
      ? block.thumbnailUrl
      : block.provider === "youtube" ? `https://i.ytimg.com/vi/${encodeURIComponent(block.ref)}/hqdefault.jpg` : null;
    return (
      <figure style={{ margin: "14px 0", minWidth: 0 }}>
        <button type="button" aria-label={`Reproduzir ${block.caption ?? "vídeo do produto"}`} onClick={() => { window.dispatchEvent(new Event("aacp:product-media-play")); setStarted(true); }} style={{ position: "relative", display: "grid", placeItems: "center", width: "100%", aspectRatio: "16 / 9", padding: 0, overflow: "hidden", border: "1px solid var(--aacp-line)", borderRadius: "10px", background: "var(--aacp-surface-elevated, var(--aacp-surface-3))", color: "var(--aacp-fg)", cursor: "pointer" }}>
          {poster ? <img src={poster} alt="" loading="lazy" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} /> : null}
          <span style={{ position: "relative", display: "grid", placeItems: "center", width: "56px", height: "56px", borderRadius: "50%", background: "var(--aacp-accent)", color: "var(--aacp-on-accent, #f8f8f8)" }} aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg></span>
        </button>
        {block.caption ? <figcaption style={{ marginTop: "12px", color: "var(--aacp-fg)", fontSize: "14px", fontWeight: 600 }}>{block.caption}</figcaption> : null}
      </figure>
    );
  }

  if (block.provider === "mp4") {
    return (
      <figure
        style={{
          margin: "14px 0",
          display: "flex",
          flexDirection: "column",
          gap: "6px",
        }}
      >
        <video
          controls
          preload="metadata"
          onError={() => setError(true)}
          style={{
            width: "100%",
            borderRadius: "var(--aacp-radius-sm)",
            background: "#000",
          }}
        >
          <source src={src} type="video/mp4" />
        </video>
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

  return (
    <figure
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
          paddingTop: "56.25%",
          borderRadius: "var(--aacp-radius-sm)",
          overflow: "hidden",
          background: "#000",
        }}
      >
        <iframe
          src={src}
          title={block.caption ?? "Video"}
          sandbox="allow-scripts allow-same-origin allow-presentation"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
          referrerPolicy="no-referrer"
          loading="lazy"
          onError={() => setError(true)}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            border: 0,
          }}
        />
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
