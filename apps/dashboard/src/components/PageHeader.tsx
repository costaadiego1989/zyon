import React, { type ReactNode } from "react";

export function PageHeader({ title, description, actions }: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return <header className="page-head page-header">
    <div className="page-header__copy"><h1>{title}</h1>{description && <p className="page-lead">{description}</p>}</div>
    {actions && <div className="page-header__actions">{actions}</div>}
  </header>;
}
