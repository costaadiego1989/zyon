import React, { type ElementType, type ReactNode } from "react";
export interface SectionHeaderProps { icon?: ReactNode | ElementType; title: string; subtitle?: string; variant?: "primary" | "secondary"; trailing?: ReactNode; }
function renderIcon(icon: SectionHeaderProps["icon"]) {
  if (!icon) return null;
  if (React.isValidElement(icon)) return icon;
  const Icon = icon as ElementType;
  return <Icon size={18} strokeWidth={1.8} aria-hidden="true" />;
}
export function SectionHeader({ icon, title, subtitle, variant = "primary", trailing }: SectionHeaderProps) {
  return <div className={"ui-section-header ui-section-header--" + variant}>
    <div className="ui-section-header__identity">
      {icon && <span className="ui-section-header__icon">{renderIcon(icon)}</span>}
      <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
    </div>
    {trailing && <div className="ui-section-header__actions">{trailing}</div>}
  </div>;
}
