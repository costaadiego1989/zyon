"use client";
import SharedCatalogProductCard from "@zyon/checkout-ui/catalog-product-card";
import type { ComponentProps } from "react";
import ImageSlideshow from "../ImageSlideshow";
import RuleNotices from "./RuleNotices";

export default function CatalogProductCard(props: Omit<ComponentProps<typeof SharedCatalogProductCard>, "renderImages" | "renderRuleNotices">) {
  return <SharedCatalogProductCard {...props}
    renderImages={(images, alt) => <ImageSlideshow images={images} alt={alt} objectFit="cover" />}
    renderRuleNotices={notices => <RuleNotices notices={notices} />} />;
}
