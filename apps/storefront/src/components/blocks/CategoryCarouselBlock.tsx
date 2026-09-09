"use client";

import { FiArrowUpRight, FiGrid } from "react-icons/fi";
import styles from "./CategoryCarouselBlock.module.css";

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
  onQuickReply?: (text: string) => void;
}) {
  return <nav className={styles.track} aria-label="Categorias da loja">
    {block.data.categories.map((category) => <button key={category.id} type="button" className={styles.category} onClick={() => onQuickReply?.("Ver produtos de " + category.name)}>
      <span className={styles.top}><FiGrid aria-hidden="true" /><FiArrowUpRight aria-hidden="true" /></span>
      <strong>{category.name}</strong>
      <span className={styles.description}>{category.description || "Explore a seleção de " + category.name}</span>
      <span className={styles.footer}>{category.productCount != null ? category.productCount + (category.productCount === 1 ? " produto" : " produtos") : "Ver produtos"}<span aria-hidden="true">→</span></span>
    </button>)}
  </nav>;
}
