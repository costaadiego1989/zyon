"use client";

import { useRef, useEffect } from "react";
import type { ProductCarouselBlock as ProductCarouselBlockType } from "@/lib/types.js";
import ProductCardBlock from "./ProductCardBlock.js";

export default function ProductCarouselBlock({
  block,
}: {
  block: ProductCarouselBlockType;
}) {
  const { data } = block;
  const scrollRef = useRef<HTMLDivElement | null>(null);

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        ref={scrollRef}
        style={{
          display: "flex",
          gap: 8,
          overflowX: "auto",
          paddingBottom: 8,
          scrollBehavior: "smooth",
          WebkitOverflowScrolling: "touch",
        }}
      >
        {data.products.map((product) => (
          <div
            key={product.id}
            style={{
              flex: "0 0 calc(50% - 4px)",
              minWidth: "calc(50% - 4px)",
            }}
          >
            <ProductCardBlock
              block={{
                type: "product_card",
                data: product,
              }}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
