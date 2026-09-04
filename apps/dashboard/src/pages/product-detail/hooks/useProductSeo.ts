import { useState, useCallback } from "react";

export function useProductSeo(
  initialSeoTitle: string = "",
  initialSeoMetaDesc: string = "",
  initialSeoSlug: string = "",
  initialSeoOgTitle: string = "",
  initialSeoOgDesc: string = "",
  initialSeoKeywords: string[] = [],
) {
  const [seoTitle, setSeoTitle] = useState(initialSeoTitle);
  const [seoMetaDesc, setSeoMetaDesc] = useState(initialSeoMetaDesc);
  const [seoSlug, setSeoSlug] = useState(initialSeoSlug);
  const [seoOgTitle, setSeoOgTitle] = useState(initialSeoOgTitle);
  const [seoOgDesc, setSeoOgDesc] = useState(initialSeoOgDesc);
  const [seoKeywords, setSeoKeywords] = useState<string[]>(initialSeoKeywords);

  const reset = useCallback(() => {
    setSeoTitle("");
    setSeoMetaDesc("");
    setSeoSlug("");
    setSeoOgTitle("");
    setSeoOgDesc("");
    setSeoKeywords([]);
  }, []);

  const loadSeo = useCallback(
    (seo: {
      seoTitle?: string | null;
      metaDescription?: string | null;
      slug?: string | null;
      ogTitle?: string | null;
      ogDescription?: string | null;
      keywords?: string[] | null;
    }) => {
      setSeoTitle(seo.seoTitle ?? "");
      setSeoMetaDesc(seo.metaDescription ?? "");
      setSeoSlug(seo.slug ?? "");
      setSeoOgTitle(seo.ogTitle ?? "");
      setSeoOgDesc(seo.ogDescription ?? "");
      setSeoKeywords(seo.keywords ?? []);
    },
    [],
  );

  const updateSeo = useCallback(
    (
      partial: Partial<{
        seoTitle: string;
        seoMetaDesc: string;
        seoSlug: string;
        seoOgTitle: string;
        seoOgDesc: string;
        seoKeywords: string[];
      }>,
    ) => {
      if (partial.seoTitle !== undefined) setSeoTitle(partial.seoTitle);
      if (partial.seoMetaDesc !== undefined) setSeoMetaDesc(partial.seoMetaDesc);
      if (partial.seoSlug !== undefined)
        setSeoSlug(partial.seoSlug.toLowerCase().replace(/[^a-z0-9-]/g, ""));
      if (partial.seoOgTitle !== undefined) setSeoOgTitle(partial.seoOgTitle);
      if (partial.seoOgDesc !== undefined) setSeoOgDesc(partial.seoOgDesc);
      if (partial.seoKeywords !== undefined) setSeoKeywords(partial.seoKeywords);
    },
    [],
  );

  return {
    seoTitle,
    setSeoTitle,
    seoMetaDesc,
    setSeoMetaDesc,
    seoSlug,
    setSeoSlug,
    seoOgTitle,
    setSeoOgTitle,
    seoOgDesc,
    setSeoOgDesc,
    seoKeywords,
    setSeoKeywords,
    reset,
    loadSeo,
    updateSeo,
  };
}
