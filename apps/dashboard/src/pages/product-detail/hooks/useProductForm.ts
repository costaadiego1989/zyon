import { useState, useCallback } from "react";
import type { ProductMetadata, ProductType } from "../ProductDetailPage.js";

export interface FoodOptionItemDraft {
  id: string;
  name: string;
  priceModifierInCents: number;
}

export interface FoodOptionGroupDraft {
  id: string;
  name: string;
  selectionType: "single" | "multiple";
  required: boolean;
  items: FoodOptionItemDraft[];
}

export const MAX_OPTION_GROUPS = 5;
export const MAX_ITEMS_PER_GROUP = 50;

export function emptyFoodOptionItem(): FoodOptionItemDraft {
  return { id: crypto.randomUUID(), name: "", priceModifierInCents: 0 };
}

export function emptyFoodOptionGroup(): FoodOptionGroupDraft {
  return {
    id: crypto.randomUUID(),
    name: "",
    selectionType: "single",
    required: false,
    items: [emptyFoodOptionItem()],
  };
}

export function useProductForm(initialName: string = "", initialDescription: string = "", initialType: ProductType = "physical") {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [productType, setProductType] = useState<ProductType>(initialType);
  const [metadata, setMetadata] = useState<ProductMetadata>({});
  const [categoryId, setCategoryId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [generatingDesc, setGeneratingDesc] = useState(false);
  const [optionGroups, setOptionGroups] = useState<FoodOptionGroupDraft[]>([]);

  const reset = useCallback(() => {
    setName("");
    setDescription("");
    setProductType("physical");
    setMetadata({});
    setCategoryId("");
    setIsActive(true);
    setGeneratingDesc(false);
    setOptionGroups([]);
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
      const t = product.type as ProductType | null;
      setProductType(t ?? "physical");
      setMetadata((product.metadata as ProductMetadata) ?? {});
      setCategoryId(product.categoryId ?? "");
      setIsActive(product.isActive);
      const incoming = product.metadata?.optionGroups;
      if (Array.isArray(incoming)) {
        setOptionGroups(
          (incoming as FoodOptionGroupDraft[]).map((g) => ({
            id: g.id ?? crypto.randomUUID(),
            name: g.name ?? "",
            selectionType: g.selectionType === "multiple" ? "multiple" : "single",
            required: !!g.required,
            items: (g.items ?? []).map((it) => ({
              id: it.id ?? crypto.randomUUID(),
              name: it.name ?? "",
              priceModifierInCents: Number(it.priceModifierInCents ?? 0) || 0,
            })),
          })),
        );
      } else {
        setOptionGroups([]);
      }
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
    optionGroups,
    setOptionGroups,
    reset,
    loadProduct,
  };
}
