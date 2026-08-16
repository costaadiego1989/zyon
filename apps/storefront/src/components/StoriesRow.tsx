"use client";

import { useCallback, useEffect, useState } from "react";
import StoryViewer from "./StoryViewer";

export interface StoryCategory {
  id: string;
  name: string;
  coverImage: string | null;
  stories: Array<{
    id: string;
    imageUrl: string;
    title?: string;
    titleConfig?: {
      font: string;
      color: string;
      hasBg: boolean;
      bgColor: string;
      bgOpacity: number;
      position: string;
    };
    duration: number;
  }>;
}

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3009";

function getViewedKey(slug: string) {
  return `stories-viewed-${slug}`;
}

function getViewedSet(slug: string): Set<string> {
  try {
    const raw = localStorage.getItem(getViewedKey(slug));
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* */ }
  return new Set();
}

function persistViewed(slug: string, viewed: Set<string>) {
  try {
    localStorage.setItem(getViewedKey(slug), JSON.stringify([...viewed]));
  } catch { /* */ }
}

export default function StoriesRow({ merchantSlug, initialCategories }: { merchantSlug: string; initialCategories?: StoryCategory[] }) {
  const [categories, setCategories] = useState<StoryCategory[]>(initialCategories ?? []);
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [viewerOpen, setViewerOpen] = useState(false);
  const [initialIndex, setInitialIndex] = useState(0);

  useEffect(() => {
    setViewed(getViewedSet(merchantSlug));
  }, [merchantSlug]);

  // Only fetch if no initial data provided
  useEffect(() => {
    if (initialCategories && initialCategories.length > 0) return;
    let cancelled = false;
    async function fetchStories() {
      try {
        const res = await fetch(`${API_BASE}/v1/storefront/${merchantSlug}/stories`);
        if (!res.ok) return;
        const data = await res.json();
        const cats = data.categories ?? data;
        if (!cancelled && Array.isArray(cats) && cats.length > 0) {
          setCategories(cats);
        }
      } catch { /* */ }
    }
    fetchStories();
    return () => { cancelled = true; };
  }, [merchantSlug, initialCategories]);

  const handleOpen = useCallback((index: number) => {
    setInitialIndex(index);
    setViewerOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setViewerOpen(false);
  }, []);

  const handleViewed = useCallback((categoryId: string) => {
    setViewed((prev) => {
      const next = new Set(prev);
      next.add(categoryId);
      persistViewed(merchantSlug, next);
      return next;
    });
  }, [merchantSlug]);

  if (categories.length === 0) return null;

  return (
    <>
      <div style={{ background: "var(--aacp-surface-2, rgba(0,0,0,0.03))", flex: "none", width: "100%", overflow: "hidden" }}>
        <div style={{ padding: "10px 18px 0", fontSize: "10px", fontWeight: 700, letterSpacing: "1.2px", textTransform: "uppercase", color: "var(--aacp-muted)" }}>
          Stories
        </div>
        <div
          className="stories-row-scroll"
          role="list"
          aria-label="Stories"
          style={{
            padding: "8px 18px 12px",
            display: "flex",
            gap: "14px",
            overflowX: "auto",
            overflowY: "hidden",
            msOverflowStyle: "none",
            scrollbarWidth: "none",
            WebkitOverflowScrolling: "touch",
          }}
        >
        <style>{`
          .stories-row-scroll::-webkit-scrollbar { display: none; }
        `}</style>
        {categories.map((cat, idx) => (
          <button
            key={cat.id}
            type="button"
            role="listitem"
            aria-label={`Ver stories de ${cat.name}`}
            onClick={() => handleOpen(idx)}
            style={{
              flex: "0 0 auto",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "4px",
              cursor: "pointer",
              background: "transparent",
              border: "none",
              padding: 0,
            }}
          >
            <div
              style={{
                width: "60px",
                height: "60px",
                borderRadius: "50%",
                border: `3px solid ${viewed.has(cat.id) ? "var(--aacp-line)" : "var(--aacp-accent)"}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                flex: "none",
              }}
            >
              {(cat.coverImage || cat.stories[0]?.imageUrl) ? (
                <img
                  src={cat.coverImage || cat.stories[0]?.imageUrl}
                  alt={cat.name}
                  loading="lazy"
                  style={{
                    width: "54px",
                    height: "54px",
                    borderRadius: "50%",
                    objectFit: "cover",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: "54px",
                    height: "54px",
                    borderRadius: "50%",
                    background: "var(--aacp-card)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "18px",
                    fontWeight: 700,
                    color: "var(--aacp-muted)",
                  }}
                >
                  {cat.name.charAt(0).toUpperCase()}
                </div>
              )}
            </div>
            <span
              style={{
                fontSize: "10px",
                color: "var(--aacp-muted)",
                maxWidth: "64px",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                textAlign: "center",
              }}
            >
              {cat.name}
            </span>
          </button>
        ))}
        </div>
      </div>

      {viewerOpen && (
        <StoryViewer
          categories={categories}
          initialCategoryIndex={initialIndex}
          onClose={handleClose}
          onViewed={handleViewed}
        />
      )}
    </>
  );
}
