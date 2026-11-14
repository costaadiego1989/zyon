"use client";

import { FiArrowUpRight, FiGrid } from "react-icons/fi";
import styles from "./CategoryCarouselBlock.module.css";
import type { StorefrontReadUiAction } from "@zyon/shared-types";
import { assertStorefrontReadUiAction } from "@/lib/storefront-read-ui-action";

interface CategoryData {
  id: string;
  name: string;
  slug: string;
  description?: string;
  emoji?: string;
  productCount?: number;
}
export interface CategoryCarouselBlock {
  type: "category_carousel";
  data: { categories: CategoryData[] };
}

export default function CategoryCarouselBlock({ block, onQuickReply }: {
  block: CategoryCarouselBlock;
  onQuickReply?: (text: string, uiAction?: StorefrontReadUiAction) => void;
}) {
  return <nav className={styles.track} aria-label="Categorias da loja">
    {block.data.categories.map((category) => <button data-neu="control" key={category.id} type="button" className={styles.category} onClick={() => {
      const uiAction: StorefrontReadUiAction = { tool: "search_products", args: { query: "*", categoryId: category.id } };
      assertStorefrontReadUiAction(uiAction);
      onQuickReply?.("Ver produtos de " + category.name, uiAction);
    }}>
      <span className={styles.top}><FiGrid aria-hidden="true" /><FiArrowUpRight aria-hidden="true" /></span>
      <strong>{category.name}</strong>
      <span className={styles.description}>{category.description || "Explore a seleção de " + category.name}</span>
      <span className={styles.footer}>{category.productCount != null ? category.productCount + (category.productCount === 1 ? " produto" : " produtos") : "Ver produtos"}<span aria-hidden="true">→</span></span>
    </button>)}
  </nav>;
}
