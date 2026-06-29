import type { CSSProperties, ReactNode } from 'react';

interface ShimmerBorderProps {
  children: ReactNode;
  radius?: string | number;
  style?: CSSProperties;
  innerStyle?: CSSProperties;
}

/** Borda brilhante estática — verde Spotify */
export function ShimmerBorder({ children, radius = '18px', style, innerStyle }: ShimmerBorderProps) {
  const r = typeof radius === 'number' ? `${radius}px` : radius;
  return (
    <div className="shimmer-border" style={{ ['--shimmer-r' as string]: r, ...style }}>
      <div className="shimmer-border__inner" style={{ background: 'var(--card)', ...innerStyle }}>
        {children}
      </div>
    </div>
  );
}
