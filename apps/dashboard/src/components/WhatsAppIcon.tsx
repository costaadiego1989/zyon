import React, { forwardRef } from "react";
import type { LucideProps } from "lucide-react";
import glyph from "../assets/whatsapp-glyph-green.svg";

// Unmodified Digital Glyph Green RGB from Meta's 2026 brand asset pack:
// https://www.meta.com/en-gb/brand/resources/whatsapp/whatsapp-brand/
export const WhatsAppIcon = forwardRef<SVGSVGElement, LucideProps>(function WhatsAppIcon(
  { size = 24, strokeWidth: _strokeWidth, absoluteStrokeWidth: _absoluteStrokeWidth, color: _color, ...props }, ref,
) {
  return <svg ref={ref} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...props}>
    <image href={glyph} width="24" height="24" />
  </svg>;
});
