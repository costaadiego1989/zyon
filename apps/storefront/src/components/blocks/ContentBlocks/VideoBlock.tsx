"use client";

import { useState } from "react";
import type { VideoBlockData } from "./types";

/**
 * Allowlist of trusted embed origins. Defense in depth — the dashboard should
 * already validate on save, but we re-check client-side to refuse anything not
 * in this list. Reject = render nothing (no placeholder).
 */
const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "youtu.be", "www.youtu.be"]);
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);

function isAllowedHttpsUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return false;
    return (
      YOUTUBE_HOSTS.has(u.hostname) ||
      VIMEO_HOSTS.has(u.hostname) ||
      u.hostname === "open.spotify.com"
    );
  } catch {
    return false;
  }
}

function buildEmbedUrl(provider: VideoBlockData["provider"], ref: string): string | null {
  if (provider === "youtube") {
    // ref is the video id (e.g. dQw4w9WgXcQ).
    if (!/^[A-Za-z0-9_-]{6,20}$/.test(ref)) return null;
    return `https://www.youtube.com/embed/${encodeURIComponent(ref)}`;
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
  const src = buildEmbedUrl(block.provider, block.ref);

  if (!src || error) return null;

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
