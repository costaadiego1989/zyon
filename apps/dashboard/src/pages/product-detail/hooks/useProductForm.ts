import { useState, useCallback } from "react";
import type { ProductMetadata } from "../ProductDetailPage.js";

export function useProductForm(initialName: string = "", initialDescription: string = "", initialType: "physical" | "digital" | "service" = "physical") {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [productType, setProductType] = useState<"physical" | "digital" | "service">(initialType);
  const [metadata, setMetadata] = useState<ProductMetadata>({});
  const [categoryId, setCategoryId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [generatingDesc, setGeneratingDesc] = useState(false);

  const reset = useCallback(() => {
    setName("");
    setDescription("");
    setProductType("physical");
    setMetadata({});
    setCategoryId("");
    setIsActive(true);
    setGeneratingDesc(false);
  }, []);

  const loadProduct = useCallback(
    (product: {
      name: string;
      description?: string | null;
      type?: string | null;
      metadata?: Record<string, unknown> | null;
      categoryId?: string | null;
      isActive: boolean;
    }) => {
      setName(product.name);
      setDescription(product.description ?? "");
      setProductType((product.type as "physical" | "digital" | "service") ?? "physical");
      setMetadata((product.metadata as ProductMetadata) ?? {});
      setCategoryId(product.categoryId ?? "");
      setIsActive(product.isActive);
    },
    [],
  );

  return {
    name,
    setName,
    description,
    setDescription,
    productType,
    setProductType,
    metadata,
    setMetadata,
    categoryId,
    setCategoryId,
    isActive,
    setIsActive,
    generatingDesc,
    setGeneratingDesc,
    reset,
    loadProduct,
  };
}
