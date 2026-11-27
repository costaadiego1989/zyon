import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export function MarketingEmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="marketing-empty">
      <span className="marketing-empty__icon" aria-hidden="true">
        <Icon size={22} strokeWidth={1.7} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action ? <div className="marketing-empty__action">{action}</div> : null}
    </div>
  );
}
