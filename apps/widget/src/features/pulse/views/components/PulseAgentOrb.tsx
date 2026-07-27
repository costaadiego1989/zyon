import type { CSSProperties } from 'react';
import {
  resolveAgentOrbPreset,
  type AgentOrbMood,
  type AgentOrbPlacement,
} from '../../config/agentOrbPresets';

export type { AgentOrbMood, AgentOrbPlacement };

export type PulseAgentOrbProps = {
  /** Localização — define tamanho e expressão (ver agentOrbPresets.ts). */
  placement: AgentOrbPlacement;
  /** Destaque no bloco ativo do chat (olhos acompanham). */
  active?: boolean;
  className?: string;
  style?: CSSProperties;
};

const SAD_MOUTH_PATH = 'M4 11 Q15 3 26 11';

const EYE_RATIOS: Record<
  AgentOrbMood,
  { w: number; h: number; gap: number; shiftY?: number }
> = {
  happy: { w: 0.086, h: 0.125, gap: 0.102 },
  sad: { w: 0.089, h: 0.1, gap: 0.122, shiftY: -0.067 },
  neutral: { w: 0.125, h: 0.156, gap: 0.094 },
};

export function PulseAgentOrb({ placement, active = false, className, style }: PulseAgentOrbProps) {
  const preset = resolveAgentOrbPreset(placement);
  const { size, mood, muted, ring, float, glow, spin } = preset;
  const ratios = EYE_RATIOS[mood];
  const mouthBottom = Math.round(size * 0.27);
  const mouthW = Math.round(size * 0.33);
  const glowInset = -Math.max(12, Math.round(size * 0.14));
  const ringInset = -Math.max(4, Math.round(size * 0.05));

  const cssVars = {
    '--orb-size': `${size}px`,
    '--orb-eye-w': `${Math.max(2, Math.round(size * ratios.w))}px`,
    '--orb-eye-h': `${Math.max(3, Math.round(size * ratios.h))}px`,
    '--orb-eye-gap': `${Math.max(2, Math.round(size * ratios.gap))}px`,
    '--orb-eye-shift-y': ratios.shiftY ? `${Math.round(size * ratios.shiftY)}px` : '0px',
  } as CSSProperties;

  const classes = [
    'pulse-agent-orb',
    `pulse-agent-orb--${mood}`,
    muted ? 'pulse-agent-orb--muted' : '',
    active ? 'pulse-agent-orb--active' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes}
      style={{
        ...cssVars,
        position: 'relative',
        width: size,
        height: size,
        flexShrink: 0,
        animation: float ? 'orbFloat 6s ease-in-out infinite' : undefined,
        ...style,
      }}
      aria-hidden
    >
      {ring && (
        <div
          className="pulse-agent-orb__ring"
          style={{
            position: 'absolute',
            inset: ringInset,
            borderRadius: '50%',
            border: '1px solid var(--aacp-accent, #1ED760)',
            animation: 'waveRing 2.6s ease-out infinite',
          }}
        />
      )}
      {glow && (
        <div
          className="pulse-agent-orb__glow"
          style={{
            position: 'absolute',
            inset: glowInset,
            borderRadius: '50%',
            background: 'var(--aacp-accent, #1ED760)',
            filter: 'blur(20px)',
            opacity: 0.38,
            pointerEvents: 'none',
          }}
        />
      )}
      <div
        className="pulse-agent-orb__sphere"
        style={{ animation: spin ? 'orbSpin 24s linear infinite' : undefined }}
      />
      <div className="pulse-agent-orb__eyes">
        <span className="pulse-agent-orb__eye" />
        <span className="pulse-agent-orb__eye" />
      </div>
      {mood === 'sad' && (
        <svg
          className="pulse-agent-orb__mouth"
          width={mouthW}
          height={Math.round(size * 0.16)}
          viewBox="0 0 30 14"
          fill="none"
          stroke="#fff"
          strokeWidth="2.4"
          strokeLinecap="round"
          style={{ bottom: mouthBottom }}
        >
          <path d={SAD_MOUTH_PATH} />
        </svg>
      )}
    </div>
  );
}
