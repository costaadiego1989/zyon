import React from "react";
import { AgentOrb } from "../pages/onboarding-wizard/components/AgentOrb.js";

export interface LoadingSplashProps {
  title?: string;
  subtitle?: string;
}

/**
 * LoadingSplash — full-screen boot loader.
 * Centered orb pulse + large title + subtitle.
 * Uses the existing AgentOrb from onboarding so the mascot stays consistent.
 */
export function LoadingSplash({
  title = "Carregando sua conta",
  subtitle = "Preparando tudo para você…",
}: LoadingSplashProps) {
  return (
    <div className="loading-splash" role="status" aria-live="polite">
      <div className="loading-splash__orb" aria-hidden="true">
        <AgentOrb color="oklch(74% 0.19 149)" size={88} />
      </div>
      <h1 className="loading-splash__title">{title}</h1>
      <p className="loading-splash__subtitle">{subtitle}</p>
      <style>{`
        .loading-splash {
          min-height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 22px;
          padding: 48px 24px;
          background: oklch(7% 0.005 150);
          font-family: 'Manrope', system-ui, sans-serif;
          position: relative;
          overflow: hidden;
        }
        .loading-splash::before {
          content: "";
          position: absolute;
          inset: 0;
          background: radial-gradient(
            ellipse 70% 60% at 50% 45%,
            oklch(55% 0.14 149 / 0.08) 0%,
            transparent 70%
          );
          pointer-events: none;
        }
        .loading-splash > * { position: relative; }
        .loading-splash__orb {
          filter: drop-shadow(0 0 40px oklch(55% 0.14 149 / 0.35));
        }
        .loading-splash__title {
          margin: 0;
          font: 700 28px/1.2 'Manrope', sans-serif;
          letter-spacing: -0.025em;
          color: oklch(96% 0.002 145);
          text-align: center;
        }
        .loading-splash__subtitle {
          margin: 0;
          font: 400 14px/1.5 'Manrope', sans-serif;
          color: oklch(60% 0.006 145);
          text-align: center;
        }
        @media (prefers-reduced-motion: reduce) {
          .loading-splash__orb { filter: none; }
        }
      `}</style>
    </div>
  );
}
