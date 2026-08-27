import { useState, useCallback } from "react";

export interface ProductVariantDraft {
  id?: string;
  sku: string;
  basePriceInput: string;
  costInput: string;
  weightInput: string;
  lengthInput: string;
  widthInput: string;
  heightInput: string;
  stockInput: string;
  attributes: Array<{ key: string; value: string }>;
  pendingImages: string[];
}

export function emptyVariant(): ProductVariantDraft {
  return {
    sku: "",
    basePriceInput: "",
    costInput: "",
    weightInput: "",
    lengthInput: "",
    widthInput: "",
    heightInput: "",
    stockInput: "0",
    attributes: [],
    pendingImages: [],
  };
}

export function useVariantManager(initialVariants: ProductVariantDraft[] = [emptyVariant()]) {
  const [variants, setVariants] = useState<ProductVariantDraft[]>(initialVariants);
  const [hasVariants, setHasVariants] = useState(initialVariants.length > 1);
  const [variantRequired, setVariantRequired] = useState(false);

  const updateVariant = useCallback((index: number, patch: Partial<ProductVariantDraft>) => {
    setVariants((prev) => prev.map((v, i) => (i === index ? { ...v, ...patch } : v)));
  }, []);

  const addVariant = useCallback(() => {
    setVariants((prev) => [...prev, emptyVariant()]);
  }, []);

  const removeVariant = useCallback((index: number) => {
    setVariants((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== index) : prev));
  }, []);

  const addAttribute = useCallback((variantIdx: number) => {
    updateVariant(variantIdx, {
      attributes: [...(variants[variantIdx]?.attributes || []), { key: "", value: "" }],
    });
  }, [variants, updateVariant]);

  const updateAttribute = useCallback(
    (variantIdx: number, attrIdx: number, patch: { key?: string; value?: string }) => {
      const newAttrs = [...(variants[variantIdx]?.attributes || [])];
      newAttrs[attrIdx] = { ...newAttrs[attrIdx], ...patch };
      updateVariant(variantIdx, { attributes: newAttrs });
    },
    [variants, updateVariant],
  );

  const removeAttribute = useCallback(
    (variantIdx: number, attrIdx: number) => {
      const newAttrs = (variants[variantIdx]?.attributes || []).filter((_, i) => i !== attrIdx);
      updateVariant(variantIdx, { attributes: newAttrs });
    },
    [variants, updateVariant],
  );

  const reset = useCallback(() => {
    setVariants([emptyVariant()]);
    setHasVariants(false);
    setVariantRequired(false);
  }, []);

  const toggleVariantsMode = useCallback((enabled: boolean) => {
    setHasVariants(enabled);
    if (!enabled) {
      setVariants([emptyVariant()]);
      setVariantRequired(false);
    }
  }, []);

  const toggleVariantRequired = useCallback((required: boolean) => {
    setVariantRequired(required);
  }, []);

  return {
    variants,
    setVariants,
    hasVariants,
    setHasVariants,
    variantRequired,
    updateVariant,
    addVariant,
    removeVariant,
    addAttribute,
    updateAttribute,
    removeAttribute,
    reset,
    toggleVariantsMode,
    toggleVariantRequired,
  };
}
