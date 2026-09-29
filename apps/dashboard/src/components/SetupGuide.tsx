import React, { type ReactNode } from "react";
import { BookOpen, ChevronDown } from "lucide-react";

/** Instructions, not progress: completion belongs to the real provider state. */
export function SetupGuide({ title = "Como configurar", intro, steps, defaultOpen = false }: {
  title?: string; intro?: ReactNode; steps: Array<{ title: string; description: ReactNode }>; defaultOpen?: boolean;
}) {
  return <details className="setup-guide" open={defaultOpen || undefined}>
    <summary><BookOpen size={18} className="setup-guide__icon" aria-hidden="true" /><span className="setup-guide__label">{title}</span><ChevronDown size={16} className="setup-guide__chevron" aria-hidden="true" /></summary>
    <div className="setup-guide__body">
      {intro && <p className="setup-guide__intro">{intro}</p>}
      <ol>{steps.map(step => <li key={step.title}><div><strong>{step.title}</strong><p>{step.description}</p></div></li>)}</ol>
    </div>
  </details>;
}
