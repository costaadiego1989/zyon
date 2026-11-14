import React from "react";

export interface RulesSkeletonProps {
  className?: string;
}

export function RulesSkeleton({ className }: RulesSkeletonProps): React.ReactElement {
  const cls = ["split-panel", className].filter(Boolean).join(" ");
  return (
    <div className={cls} aria-busy="true" aria-label="Carregando configurações">
      <div className="split-panel-controls">
        <div className="skeleton-block" style={{ height: 200 }} />
        <div className="skeleton-block" style={{ height: 120 }} />
        <div className="skeleton-block" style={{ height: 180 }} />
      </div>
      <div className="split-panel-preview">
        <div className="skeleton-block" style={{ height: 400 }} />
      </div>
    </div>
  );
}
