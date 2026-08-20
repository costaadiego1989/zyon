import { useState, useCallback } from "react";

export interface MediaItem {
  id: string;
  url: string;
}

export function useMediaUploader() {
  const [variantMedia, setVariantMedia] = useState<Record<string, MediaItem[]>>({});
  const [uploadingVariant, setUploadingVariant] = useState<string | null>(null);

  const addMedia = useCallback((variantId: string, media: MediaItem) => {
    setVariantMedia((prev) => ({
      ...prev,
      [variantId]: [...(prev[variantId] || []), media],
    }));
  }, []);

  const removeMedia = useCallback((variantId: string, mediaId: string) => {
    setVariantMedia((prev) => ({
      ...prev,
      [variantId]: (prev[variantId] || []).filter((m) => m.id !== mediaId),
    }));
  }, []);

  const addPendingImage = useCallback((variantId: string, base64: string) => {
    setVariantMedia((prev) => {
      const pending = (prev[`pending-${variantId}`] || []);
      // Create a pseudo-media object for pending images
      return {
        ...prev,
        [`pending-${variantId}`]: [...pending, { id: `pending-${Date.now()}`, url: base64 }],
      };
    });
  }, []);

  const removePendingImage = useCallback((variantId: string, imageIdx: number) => {
    setVariantMedia((prev) => {
      const pending = (prev[`pending-${variantId}`] || []);
      return {
        ...prev,
        [`pending-${variantId}`]: pending.filter((_, i) => i !== imageIdx),
      };
    });
  }, []);

  const clearPendingImages = useCallback(() => {
    setVariantMedia((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((key) => {
        if (key.startsWith("pending-")) delete next[key];
      });
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setVariantMedia({});
    setUploadingVariant(null);
  }, []);

  return {
    variantMedia,
    uploadingVariant,
    setUploadingVariant,
    addMedia,
    removeMedia,
    addPendingImage,
    removePendingImage,
    clearPendingImages,
    reset,
  };
}
