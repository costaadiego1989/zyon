import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

export function Disclosure({ title, note, children, className = "" }: {
  title: string;
  note?: string;
  children: ReactNode;
  className?: string;
}) {
  return <details className={`control-details ${className}`}>
    <summary><span>{title}{note ? <small>{note}</small> : null}</span><ChevronDown size={16} aria-hidden="true" /></summary>
    <div className="control-details__content">{children}</div>
  </details>;
}
