import React from "react";

/**
 * Brand marks for payment providers, inlined as SVG (no external asset fetches;
 * CSP-safe). Default fill is white to sit on GatewayCard's colored icon
 * background; pass color="currentColor" to inherit (e.g. inside SectionHeader,
 * which tints its icon with --color-brand).
 */

interface LogoProps {
  size?: number;
  color?: string;
}

export function StripeLogo({ size = 18, color = "#fff" }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M13.6 10.2c-1.7-.63-2.6-1-2.6-1.7 0-.6.5-.94 1.4-.94 1.3 0 2.63.5 3.55.96l.5-3.1c-.73-.35-2.2-.9-4.1-.9-1.4 0-2.57.37-3.4 1.05-.87.72-1.32 1.75-1.32 3 0 2.26 1.4 3.23 3.65 4.05 1.45.52 1.94.9 1.94 1.47 0 .55-.47.87-1.32.87-1.05 0-2.8-.52-3.93-1.2l-.5 3.14c.97.55 2.75 1.12 4.6 1.12 1.48 0 2.72-.35 3.55-1.02.93-.73 1.4-1.8 1.4-3.2 0-2.3-1.42-3.27-3.6-4.08z"
        fill={color}
      />
    </svg>
  );
}

export function AsaasLogo({ size = 18, color = "#fff" }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.2 3.6 20.4h3.9l1.4-3.1h6.2l1.4 3.1h3.9L12 3.2zm-1.7 10.7L12 9.9l1.7 4z"
        fill={color}
      />
    </svg>
  );
}

export function MercadoPagoLogo({ size = 18, color = "#fff" }: LogoProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 6c-4.4 0-8 2.5-8 5.6 0 1.5.9 2.9 2.3 3.9l-.6 2.5 2.8-1.4c1.1.4 2.3.6 3.5.6 4.4 0 8-2.5 8-5.6S16.4 6 12 6z"
        fill={color}
      />
      <circle cx="9.2" cy="11.6" r="1.05" fill="#009EE3" />
      <circle cx="12" cy="11.6" r="1.05" fill="#009EE3" />
      <circle cx="14.8" cy="11.6" r="1.05" fill="#009EE3" />
    </svg>
  );
}
